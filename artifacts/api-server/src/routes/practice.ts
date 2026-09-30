import { eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import {
  GetPracticeHistoryResponse,
  GetPracticeRecommendationQueryParams,
  GetPracticeRecommendationResponse,
  GetPracticeUsageResponse,
  ListPracticeQuestionsQueryParams,
  ListPracticeQuestionsResponse,
  SubmitPracticeAttemptBody,
  SubmitPracticeAttemptResponse,
} from "@workspace/api-zod";
import { db, practiceQuestionsTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  ensureAuthenticatedPracticeLearner,
  getPracticeUsage,
  PracticeLearnerLinkConflictError,
} from "../lib/practice-usage";
import { executePracticeCoachingRequest } from "../lib/practice-coaching-request";
import {
  getPracticeHistory,
  getPracticeRecommendation,
  persistPracticeAttempt,
} from "../lib/practice-learning";
import {
  createPracticeProCheckout,
  hasWhopCheckoutConfiguration,
} from "../lib/practice-billing";
import { ensureSeedData } from "../lib/seed";

const router: IRouter = Router();
const LEARNER_COOKIE_NAME = "lumen_learner";
const LEARNER_COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000;

function getSignedLearnerId(req: Request): string | undefined {
  const signedLearnerId = req.signedCookies?.[LEARNER_COOKIE_NAME];
  if (
    typeof signedLearnerId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      signedLearnerId,
    )
  ) {
    return signedLearnerId;
  }

  return undefined;
}

function setLearnerCookie(res: Response, learnerId: string): void {
  res.cookie(LEARNER_COOKIE_NAME, learnerId, {
    signed: true,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: LEARNER_COOKIE_MAX_AGE,
    path: "/",
  });
}

async function getAuthenticatedLearner(req: Request, res: Response) {
  const authUserId = getAuth(req).userId;
  if (!authUserId) {
    res.status(401).json({ error: "Sign in to use the practice coach." });
    return null;
  }

  try {
    const learner = await ensureAuthenticatedPracticeLearner(
      authUserId,
      getSignedLearnerId(req),
    );
    setLearnerCookie(res, learner.learnerId);
    return learner;
  } catch (error) {
    if (error instanceof PracticeLearnerLinkConflictError) {
      res.status(409).json({
        error: error.message,
        code: "PRACTICE_LEARNER_LINK_CONFLICT",
        conflictId: error.conflictId,
        status: error.status,
      });
      return null;
    }
    throw error;
  }
}

router.get("/practice/questions", async (req, res): Promise<void> => {
  await ensureSeedData();
  const query = ListPracticeQuestionsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const questions = await db.select().from(practiceQuestionsTable);
  const filtered = query.data.skill
    ? questions.filter((question) => question.skill === query.data.skill)
    : questions;
  res.json(
    ListPracticeQuestionsResponse.parse(
      filtered.map(({ correctOption: _correctOption, ...question }) => question),
    ),
  );
});

router.get("/practice/recommendation", async (req, res): Promise<void> => {
  const learner = await getAuthenticatedLearner(req, res);
  if (!learner) return;

  const rawExcludedQuestionIds = req.query.excludeQuestionIds;
  const query = GetPracticeRecommendationQueryParams.safeParse({
    ...req.query,
    excludeQuestionIds:
      rawExcludedQuestionIds === undefined
        ? undefined
        : Array.isArray(rawExcludedQuestionIds)
          ? rawExcludedQuestionIds
          : [rawExcludedQuestionIds],
  });
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  await ensureSeedData();
  const recommendation = await getPracticeRecommendation(
    learner.learnerId,
    query.data.excludeQuestionIds,
  );
  if (!recommendation) {
    res.status(503).json({ error: "No practice questions are available yet." });
    return;
  }
  res.json(GetPracticeRecommendationResponse.parse(recommendation));
});

router.get("/practice/history", async (req, res): Promise<void> => {
  const learner = await getAuthenticatedLearner(req, res);
  if (!learner) return;

  await ensureSeedData();
  res.json(
    GetPracticeHistoryResponse.parse(
      await getPracticeHistory(learner.learnerId),
    ),
  );
});

router.get("/practice/usage", async (req, res): Promise<void> => {
  const learner = await getAuthenticatedLearner(req, res);
  if (!learner) return;
  res.json(
    GetPracticeUsageResponse.parse(
      await getPracticeUsage(learner),
    ),
  );
});

router.post("/practice/checkout", async (req, res): Promise<void> => {
  const learner = await getAuthenticatedLearner(req, res);
  if (!learner) return;

  if (!hasWhopCheckoutConfiguration()) {
    res.status(503).json({ error: "Pro checkout is not configured yet." });
    return;
  }

  if (
    learner.plan === "pro" ||
    (learner.whopMembershipId &&
      ["active", "canceling", "past_due"].includes(learner.whopStatus ?? ""))
  ) {
    res.status(409).json({
      error:
        "This learner already has a Pro subscription. Use the subscription management link instead.",
    });
    return;
  }

  const originHeader = req.get("origin");
  const refererHeader = req.get("referer");
  let redirectUrl: string;
  try {
    if (!originHeader || !refererHeader) throw new Error("Missing browser origin.");
    const origin = new URL(originHeader);
    const referer = new URL(refererHeader);
    const practicePath = referer.pathname.replace(/\/+$/, "");
    if (
      origin.protocol !== "https:" ||
      referer.origin !== origin.origin ||
      !practicePath.endsWith("/practice")
    ) {
      throw new Error("Invalid checkout return location.");
    }
    referer.searchParams.set("billing", "complete");
    redirectUrl = referer.toString();
  } catch {
    res.status(400).json({ error: "A valid practice-page return URL is required." });
    return;
  }

  try {
    const purchaseUrl = await createPracticeProCheckout(
      learner.learnerId,
      redirectUrl,
    );
    res.json({ purchaseUrl });
  } catch (error) {
    req.log.error(
      {
        learnerId: learner.learnerId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "Whop checkout creation failed",
    );
    res.status(502).json({ error: "Unable to start Pro checkout right now." });
  }
});

router.post("/practice/attempts", async (req, res): Promise<void> => {
  const learner = await getAuthenticatedLearner(req, res);
  if (!learner) return;

  await ensureSeedData();
  const body = SubmitPracticeAttemptBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [question] = await db
    .select()
    .from(practiceQuestionsTable)
    .where(eq(practiceQuestionsTable.id, body.data.questionId));
  if (!question) {
    res.status(404).json({ error: "Practice question not found" });
    return;
  }

  const correct = body.data.answer === question.correctOption;
  const coachingOutcome = await executePracticeCoachingRequest(
    learner,
    async () => {
      const coachingResponse = await openai.chat.completions.create({
        model: "gpt-5.6-terra",
        max_completion_tokens: 400,
        messages: [
          {
            role: "system",
            content:
              "You are the Lumen AI Academy practice coach. Give concise, specific, encouraging feedback that helps a learner improve their AI judgment. Use plain text only, no markdown headings, no emojis, and no more than three sentences. Mention what the learner did well when possible. If the answer is incorrect, explain the key distinction and what to notice next time.",
          },
          {
            role: "user",
            content: [
              `Situation: ${question.context}`,
              `Question: ${question.prompt}`,
              `Learner answer: ${body.data.answer}`,
              `Best answer: ${question.correctOption}`,
              `Was the learner correct? ${correct ? "Yes" : "No"}`,
            ].join("\n"),
          },
        ],
      });

      return coachingResponse.choices[0]?.message.content ?? "";
    },
    undefined,
    (tx, feedback) =>
      persistPracticeAttempt(
        tx,
        learner.learnerId,
        question,
        body.data.answer,
        correct,
        feedback,
      ),
  );

  if (coachingOutcome.status === 429) {
    res.status(coachingOutcome.status).json({
      error:
        learner.plan === "pro"
          ? "The monthly Pro coaching allowance has been reached."
          : "The monthly Free coaching allowance has been reached.",
      usage: GetPracticeUsageResponse.parse(coachingOutcome.usage),
    });
    return;
  }

  if (coachingOutcome.status === 503) {
    req.log.error({ err: coachingOutcome.error }, "AI coaching request failed");
    if ("releaseError" in coachingOutcome) {
      req.log.error(
        { err: coachingOutcome.releaseError, learnerId: learner.learnerId },
        "Failed to release coaching usage after an AI error",
      );
    }
    res.status(503).json({
      error: "The AI coach is temporarily unavailable. Please try again.",
    });
    return;
  }

  const { reservation, feedback } = coachingOutcome;
  res.json(
    SubmitPracticeAttemptResponse.parse({
      questionId: question.id,
      correct,
      answer: body.data.answer,
      correctAnswer: question.correctOption,
      feedback,
      pointsEarned: correct ? 25 : 5,
      usage: reservation.usage,
    }),
  );
});

export default router;