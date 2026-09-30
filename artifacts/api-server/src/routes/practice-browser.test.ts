import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server as NetServer } from "node:net";
import path from "node:path";
import test, { after, before } from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import {
  db,
  pool,
  practiceAttemptsTable,
  practiceLearnersTable,
  practiceQuestionsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { createFeedback } from "../test-support/practice-route-boundaries";
import router from "./practice";

const skill = "Prompt clarity";
const warmupId = `browser-${randomUUID()}-warmup`;
const coreId = `browser-${randomUUID()}-core`;
const firstLearner = {
  authUserId: `browser-e2e-first-${randomUUID()}`,
  learnerId: randomUUID(),
};
const secondLearner = {
  authUserId: `browser-e2e-second-${randomUUID()}`,
  learnerId: randomUUID(),
};
const fixtureLearners = [firstLearner, secondLearner];
const fixtureQuestions = [
  {
    id: warmupId,
    prompt: "A warm-up question for the second learner",
    context: "A browser-isolation test scenario",
    options: ["Check the source", "Guess quickly"],
    correctOption: "Check the source",
    skill,
    difficulty: "Warm-up",
  },
  {
    id: coreId,
    prompt: "A core question for the first learner",
    context: "A browser-isolation test scenario",
    options: ["Name the goal", "Add unrelated detail"],
    correctOption: "Name the goal",
    skill,
    difficulty: "Core",
  },
];

let browser: Browser | undefined;
let apiServer: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
let viteProcess: ChildProcess | undefined;
let viteOutput = "";
let apiPort: number;
let vitePort: number;
let pageUrl: string;
const contexts: BrowserContext[] = [];
const pageErrors: Error[] = [];

async function getFreePort(): Promise<number> {
  const probe: NetServer = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    probe.close(error => error ? reject(error) : resolve());
  });
  return port;
}

async function waitForUrl(url: string): Promise<void> {
  const startedAt = Date.now();
  let lastError = "Vite did not become ready.";
  while (Date.now() - startedAt < 30_000) {
    if (viteProcess?.exitCode !== null && viteProcess?.exitCode !== undefined) {
      throw new Error(`Practice browser test server exited early.\n${viteOutput}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `Vite returned HTTP ${response.status}.`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`${lastError}\n${viteOutput}`);
}

async function openLearnerSession(authUserId: string): Promise<{
  context: BrowserContext;
  page: Page;
}> {
  if (!browser) throw new Error("Practice browser test did not start Chromium.");
  const context = await browser.newContext();
  context.setDefaultTimeout(10_000);
  contexts.push(context);
  await context.addInitScript((userId: string) => {
    (globalThis as unknown as Record<string, unknown>)["__PRACTICE_E2E_USER_ID__"] = userId;
  }, authUserId);
  await context.route("**/api/practice/**", async route => {
    const upstreamUrl = new URL(route.request().url());
    upstreamUrl.port = String(apiPort);
    const headers = await route.request().allHeaders();
    delete headers["host"];
    headers["x-test-auth-user"] = authUserId;
    const response = await route.fetch({
      url: upstreamUrl.toString(),
      headers,
      timeout: 10_000,
    });
    await route.fulfill({ response });
  });

  const page = await context.newPage();
  page.on("pageerror", error => pageErrors.push(error));
  const browserMessages: string[] = [];
  page.on("console", message => {
    if (message.type() === "error") browserMessages.push(message.text());
  });
  page.on("requestfailed", request => {
    browserMessages.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`);
  });
  const response = await page.goto(pageUrl);
  assert.equal(response?.status(), 200, "The practice test page should load.");
  try {
    await page.getByTestId("heading-practice").waitFor();
    await page.getByTestId("progress-skill-prompt-clarity").waitFor();
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(
      `Practice page did not finish loading.\nBody: ${body}\nBrowser messages: ${browserMessages.join("\n")}\nVite: ${viteOutput}`,
      { cause: error },
    );
  }
  return { context, page };
}

before(async () => {
  await db.insert(practiceLearnersTable).values(fixtureLearners);
  await db.insert(practiceQuestionsTable).values([...fixtureQuestions]);

  const firstAttemptDate = new Date("2026-09-28T10:00:00.000Z");
  const secondAttemptDate = new Date("2026-09-28T11:00:00.000Z");
  await db.insert(practiceAttemptsTable).values([
    {
      attemptId: randomUUID(),
      learnerId: firstLearner.learnerId,
      questionId: warmupId,
      prompt: "A first learner question",
      skill,
      difficulty: "Warm-up",
      answer: "Name the goal",
      correctAnswer: "Name the goal",
      correct: true,
      feedback: "FIRST_LEARNER_PRIVATE_FEEDBACK",
      pointsEarned: 25,
      createdAt: firstAttemptDate,
    },
    {
      attemptId: randomUUID(),
      learnerId: firstLearner.learnerId,
      questionId: warmupId,
      prompt: "A first learner question",
      skill,
      difficulty: "Warm-up",
      answer: "Name the goal",
      correctAnswer: "Name the goal",
      correct: true,
      feedback: "FIRST_LEARNER_RECENT_FEEDBACK",
      pointsEarned: 25,
      createdAt: secondAttemptDate,
    },
    {
      attemptId: randomUUID(),
      learnerId: secondLearner.learnerId,
      questionId: coreId,
      prompt: "A second learner question",
      skill,
      difficulty: "Core",
      answer: "Guess quickly",
      correctAnswer: "Name the goal",
      correct: false,
      feedback: "SECOND_LEARNER_PRIVATE_FEEDBACK",
      pointsEarned: 5,
      createdAt: firstAttemptDate,
    },
    {
      attemptId: randomUUID(),
      learnerId: secondLearner.learnerId,
      questionId: coreId,
      prompt: "A second learner question",
      skill,
      difficulty: "Core",
      answer: "Guess quickly",
      correctAnswer: "Name the goal",
      correct: false,
      feedback: "SECOND_LEARNER_RECENT_FEEDBACK",
      pointsEarned: 5,
      createdAt: secondAttemptDate,
    },
  ]);

  const app = express();
  app.use(express.json(), cookieParser("practice-browser-test-secret"));
  app.use((req, _res, next) => {
    (req as typeof req & { log: { error: () => void } }).log = {
      error: () => undefined,
    } as never;
    next();
  });
  app.use("/api", router);
  apiServer = app.listen(0, "127.0.0.1");
  await once(apiServer, "listening");
  const apiAddress = apiServer.address();
  assert.ok(apiAddress && typeof apiAddress !== "string");
  apiPort = apiAddress.port;

  vitePort = await getFreePort();
  const workspaceRoot = path.resolve(process.cwd(), "../..");
  const webDir = path.join(workspaceRoot, "artifacts/ai-training-platform");
  const viteCli = path.join(webDir, "node_modules/vite/bin/vite.js");
  viteProcess = spawn(
    process.execPath,
    [
      viteCli,
      "--config",
      "vite.e2e.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      String(vitePort),
      "--strictPort",
    ],
    {
      cwd: webDir,
      env: { ...process.env, PORT: String(vitePort), BASE_PATH: "/" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  viteProcess.stdout?.on("data", chunk => { viteOutput += String(chunk); });
  viteProcess.stderr?.on("data", chunk => { viteOutput += String(chunk); });
  pageUrl = `http://127.0.0.1:${vitePort}/practice-e2e.html`;
  await waitForUrl(pageUrl);
  browser = await chromium.launch({
    headless: true,
    ...(process.env["CHROMIUM_PATH"]
      ? { executablePath: process.env["CHROMIUM_PATH"] }
      : {}),
  });
});

test("two signed-in browser sessions show only their own practice history and progress", async () => {
  const feedbackCallsBefore = createFeedback.mock.callCount();
  const first = await openLearnerSession(firstLearner.authUserId);
  const second = await openLearnerSession(secondLearner.authUserId);

  const firstBody = await first.page.locator("body").innerText();
  const secondBody = await second.page.locator("body").innerText();
  const firstProgress = await first.page.getByTestId("progress-skill-prompt-clarity").innerText();
  const secondProgress = await second.page.getByTestId("progress-skill-prompt-clarity").innerText();

  assert.match(firstBody, /FIRST_LEARNER_RECENT_FEEDBACK/);
  assert.doesNotMatch(firstBody, /SECOND_LEARNER_(?:PRIVATE|RECENT)_FEEDBACK/);
  assert.match(firstBody, /Your recent answers are strong, so this question increases the challenge\./);
  assert.match(firstBody, /A core question for the first learner/);
  assert.match(firstProgress, /100% recent/);
  assert.match(firstProgress, /2 recent attempts · next Core/);

  assert.match(secondBody, /SECOND_LEARNER_RECENT_FEEDBACK/);
  assert.doesNotMatch(secondBody, /FIRST_LEARNER_(?:PRIVATE|RECENT)_FEEDBACK/);
  assert.match(secondBody, /Recent answers show that Prompt clarity is worth practicing again\./);
  assert.match(secondBody, /A warm-up question for the second learner/);
  assert.match(secondProgress, /0% recent/);
  assert.match(secondProgress, /2 recent attempts · next Warm-up/);

  assert.equal(createFeedback.mock.callCount(), feedbackCallsBefore, "The browser check must not call the AI provider.");
  assert.deepEqual(pageErrors, [], "The practice page should not raise browser runtime errors.");
});

after(async () => {
  for (const context of contexts) await context.close();
  if (browser) await browser.close();

  if (viteProcess && viteProcess.exitCode === null) {
    viteProcess.kill("SIGTERM");
    await Promise.race([
      once(viteProcess, "exit"),
      new Promise(resolve => setTimeout(resolve, 5_000)),
    ]);
    if (viteProcess.exitCode === null) viteProcess.kill("SIGKILL");
  }

  if (apiServer) {
    const server = apiServer;
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }

  try {
    for (const learner of fixtureLearners) {
      await db.delete(practiceLearnersTable)
        .where(eq(practiceLearnersTable.learnerId, learner.learnerId));
    }
    for (const question of fixtureQuestions) {
      await db.delete(practiceQuestionsTable)
        .where(eq(practiceQuestionsTable.id, question.id));
    }
  } finally {
    await pool.end();
  }
});