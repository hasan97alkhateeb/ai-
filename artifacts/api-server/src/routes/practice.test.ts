import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { after, test } from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import { eq } from "drizzle-orm";
import {
  db, pool, practiceLearnersTable, practiceAttemptsTable, practiceCoachingUsageTable,
  practiceQuestionsTable,
} from "@workspace/db";
import router from "./practice";
import { createFeedback } from "../test-support/practice-route-boundaries";

after(async () => { await pool.end(); });

for (const { plan, cap, label } of [
  { plan: "free", cap: 20, label: "Free" },
  { plan: "pro", cap: 500, label: "Pro" },
] as const) {
  test(`authenticated ${label} submission at cap returns HTTP 429 without AI`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-15T12:00:00Z") });
    const learnerId = randomUUID();
    const authUserId = `route-test-${randomUUID()}`;
    const questionId = `route-test-${randomUUID()}`;
    const callsBefore = createFeedback.mock.callCount();
    const app = express();
    app.use(express.json(), cookieParser("route-test-cookie-secret"));
    app.use("/api", router);
    const server = app.listen(0, "127.0.0.1");

    try {
      await once(server, "listening");
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      await db.insert(practiceLearnersTable).values({ learnerId, authUserId, plan });
      await db.insert(practiceCoachingUsageTable).values({
        learnerId, periodKey: "2026-09", used: cap,
      });
      await db.insert(practiceQuestionsTable).values({
        id: questionId, prompt: "Which answer is correct?", context: "Route test",
        options: ["A", "B"], correctOption: "A", skill: "prompting", difficulty: "beginner",
      });

      const url = `http://127.0.0.1:${address.port}/api/practice/attempts`;
      const body = JSON.stringify({ questionId, answer: "A" });
      // Prove the harness still exercises the route's authentication gate.
      const anonymous = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" }, body,
      });
      assert.equal(anonymous.status, 401);
      assert.deepEqual(await anonymous.json(), { error: "Sign in to use the practice coach." });

      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-auth-user": authUserId },
        body,
      });
      assert.equal(response.status, 429);
      assert.match(response.headers.get("content-type") ?? "", /application\/json/);
      const payload = await response.json() as {
        error: unknown;
        usage: Record<string, unknown>;
      };
      assert.equal(payload.error, `The monthly ${label} coaching allowance has been reached.`);
      assert.deepEqual(
        {
          learnerId: payload.usage.learnerId, plan: payload.usage.plan,
          used: payload.usage.used, monthlyLimit: payload.usage.monthlyLimit,
          remaining: payload.usage.remaining, resetsAt: payload.usage.resetsAt,
        },
        { learnerId, plan, used: cap, monthlyLimit: cap, remaining: 0,
          resetsAt: "2026-10-01T00:00:00.000Z" },
      );
      assert.equal(payload.usage.subscriptionStatus, null);
      assert.equal(payload.usage.subscriptionPeriodEndsAt, null);
      assert.equal(payload.usage.subscriptionManagementUrl, null);
      assert.equal(payload.usage.paymentRecoveryUrl, null);
      assert.equal(typeof payload.usage.checkoutAvailable, "boolean");
      if (plan === "pro") assert.equal(payload.usage.upgradeUrl, null);
      else assert.ok(payload.usage.upgradeUrl === null || typeof payload.usage.upgradeUrl === "string");
      assert.equal(createFeedback.mock.callCount(), callsBefore);
      const rows = await db.select().from(practiceCoachingUsageTable)
        .where(eq(practiceCoachingUsageTable.learnerId, learnerId));
      assert.equal(rows.length, 1);
      assert.equal(rows[0].used, cap);
      assert.equal(rows[0].periodKey, "2026-09");
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      try {
        await db.delete(practiceQuestionsTable).where(eq(practiceQuestionsTable.id, questionId));
      } finally {
        await db.delete(practiceLearnersTable).where(eq(practiceLearnersTable.learnerId, learnerId));
      }
    }
  });
}

test("successful coached attempts persist per learner and adjust the next question", async () => {
  const authUserId = `history-test-${randomUUID()}`;
  const strugglingAuthUserId = `history-struggling-test-${randomUUID()}`;
  const questionPrefix = `history-test-${randomUUID()}`;
  const warmupId = `${questionPrefix}-warmup`;
  const coreId = `${questionPrefix}-core`;
  const app = express();
  const routeErrors: unknown[] = [];
  app.use(express.json(), cookieParser("route-test-cookie-secret"));
  app.use((req, _res, next) => {
    const loggedRequest = req as typeof req & {
      log: { error: (context: unknown, message: string) => void };
    };
    loggedRequest.log = {
      error: (context: unknown) => {
        routeErrors.push(context);
      },
    } as never;
    next();
  });
  app.use("/api", router);
  const server = app.listen(0, "127.0.0.1");

  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await db.insert(practiceQuestionsTable).values([
      {
        id: warmupId,
        prompt: "A warm-up prompt",
        context: "Practice context",
        options: ["Clear answer", "Unclear answer"],
        correctOption: "Clear answer",
        skill: "Prompt clarity",
        difficulty: "Warm-up",
      },
      {
        id: coreId,
        prompt: "A core prompt",
        context: "Practice context",
        options: ["Helpful answer", "Unhelpful answer"],
        correctOption: "Helpful answer",
        skill: "Prompt clarity",
        difficulty: "Core",
      },
    ]);

    const baseUrl = `http://127.0.0.1:${address.port}/api/practice`;
    createFeedback.mock.mockImplementationOnce(async () => ({
      choices: [{ message: { content: "Name the outcome and the audience." } }],
    }) as never);
    const firstAttempt = await fetch(`${baseUrl}/attempts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-auth-user": authUserId,
      },
      body: JSON.stringify({ questionId: warmupId, answer: "Clear answer" }),
    });
    const firstAttemptBody = await firstAttempt.text();
    const providerError = (routeErrors[0] as { err?: Error } | undefined)?.err;
    assert.equal(
      firstAttempt.status,
      200,
      `${firstAttemptBody}; ${providerError?.message ?? "no route error captured"}`,
    );
    const firstPayload = JSON.parse(firstAttemptBody) as {
      usage: { learnerId: string; used: number };
    };
    assert.equal(firstPayload.usage.used, 1);

    createFeedback.mock.mockImplementationOnce(async () => ({
      choices: [{ message: { content: "Keep checking the audience and intended outcome." } }],
    }) as never);
    const secondAttempt = await fetch(`${baseUrl}/attempts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-auth-user": authUserId,
      },
      body: JSON.stringify({ questionId: warmupId, answer: "Clear answer" }),
    });
    assert.equal(secondAttempt.status, 200);
    const secondPayload = await secondAttempt.json() as {
      usage: { learnerId: string; used: number };
    };
    assert.equal(secondPayload.usage.learnerId, firstPayload.usage.learnerId);
    assert.equal(secondPayload.usage.used, 2);

    const storedAttempts = await db.select().from(practiceAttemptsTable)
      .where(eq(practiceAttemptsTable.learnerId, firstPayload.usage.learnerId));
    assert.equal(storedAttempts.length, 2);
    assert.ok(storedAttempts.every((attempt) => attempt.correct));
    assert.ok(storedAttempts.every((attempt) => attempt.feedback.length > 0));

    const historyResponse = await fetch(`${baseUrl}/history`, {
      headers: { "x-test-auth-user": authUserId },
    });
    assert.equal(historyResponse.status, 200);
    const history = await historyResponse.json() as {
      attempts: Array<{ feedback: string }>;
      skillProgress: Array<{
        skill: string;
        accuracyPercent: number;
        nextDifficulty: string;
      }>;
    };
    assert.equal(history.attempts.length, 2);
    assert.equal(history.skillProgress[0]?.accuracyPercent, 100);
    assert.equal(history.skillProgress[0]?.nextDifficulty, "Core");

    const recommendationResponse = await fetch(
      `${baseUrl}/recommendation?excludeQuestionIds=${encodeURIComponent(warmupId)}`,
      {
      headers: { "x-test-auth-user": authUserId },
      },
    );
    assert.equal(recommendationResponse.status, 200);
    const recommendation = await recommendationResponse.json() as {
      question: { id: string; difficulty: string };
      focusSkill: string;
    };
    assert.equal(recommendation.focusSkill, "Prompt clarity");
    assert.equal(recommendation.question.id, coreId);
    assert.equal(recommendation.question.difficulty, "Core");

    for (let index = 0; index < 2; index += 1) {
      createFeedback.mock.mockImplementationOnce(async () => ({
        choices: [{ message: { content: "Check the source before deciding." } }],
      }) as never);
      const missedAttempt = await fetch(`${baseUrl}/attempts`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-auth-user": strugglingAuthUserId,
        },
        body: JSON.stringify({ questionId: coreId, answer: "Unhelpful answer" }),
      });
      assert.equal(missedAttempt.status, 200);
      assert.equal((await missedAttempt.json() as { correct: boolean }).correct, false);
    }

    const strugglingRecommendationResponse = await fetch(`${baseUrl}/recommendation`, {
      headers: { "x-test-auth-user": strugglingAuthUserId },
    });
    assert.equal(strugglingRecommendationResponse.status, 200);
    const strugglingRecommendation = await strugglingRecommendationResponse.json() as {
      question: { id: string; difficulty: string };
    };
    assert.equal(strugglingRecommendation.question.id, warmupId);
    assert.equal(strugglingRecommendation.question.difficulty, "Warm-up");

    const otherLearnerHistoryResponse = await fetch(`${baseUrl}/history`, {
      headers: { "x-test-auth-user": `other-${randomUUID()}` },
    });
    assert.equal(otherLearnerHistoryResponse.status, 200);
    const otherLearnerHistory = await otherLearnerHistoryResponse.json() as {
      attempts: unknown[];
    };
    assert.deepEqual(otherLearnerHistory.attempts, []);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    try {
      await db.delete(practiceQuestionsTable).where(eq(practiceQuestionsTable.id, warmupId));
      await db.delete(practiceQuestionsTable).where(eq(practiceQuestionsTable.id, coreId));
    } finally {
      await db.delete(practiceLearnersTable).where(eq(practiceLearnersTable.authUserId, authUserId));
      await db.delete(practiceLearnersTable).where(eq(practiceLearnersTable.authUserId, strugglingAuthUserId));
    }
  }
});