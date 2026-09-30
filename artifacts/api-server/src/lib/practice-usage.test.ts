import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, mock, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import {
  db,
  pool,
  practiceCoachingUsageTable,
  practiceCoachingReservationsTable as reservations,
  practiceLearnersTable,
} from "@workspace/db";
import { executePracticeCoachingRequest } from "./practice-coaching-request.js";
import {
  FREE_COACHING_MONTHLY_LIMIT,
  getPracticeUsage,
  PRO_COACHING_MONTHLY_LIMIT,
  reservePracticeCoachingRequest,
} from "./practice-usage.js";
import {
  completePracticeCoachingRequest,
  releasePracticeCoachingRequest,
  reconcilePracticeCoachingReservations,
} from "./practice-reservations.js";

type PracticeLearner = typeof practiceLearnersTable.$inferSelect;

const testNow = new Date("2026-09-15T12:00:00.000Z");

async function withLearner(
  plan: "free" | "pro",
  run: (learner: PracticeLearner) => Promise<void>,
): Promise<void> {
  const learnerId = randomUUID();
  await db.execute(
    sql`insert into practice_learners (learner_id, plan) values (${learnerId}, ${plan}::coaching_plan)`,
  );
  const learner: PracticeLearner = {
    learnerId,
    authUserId: null,
    plan,
    whopMembershipId: null,
    whopCheckoutConfigurationId: null,
    whopPlanId: null,
    whopStatus: null,
    whopCurrentPeriodEnd: null,
    whopManageUrl: null,
    whopRecoveryUrl: null,
    whopLastEventAt: null,
    createdAt: testNow,
  };

  try {
    await run(learner);
  } finally {
    await db
      .delete(practiceLearnersTable)
      .where(eq(practiceLearnersTable.learnerId, learner.learnerId));
  }
}

async function setUsage(
  learnerId: string,
  periodKey: string,
  used: number,
): Promise<void> {
  await db.insert(practiceCoachingUsageTable).values({
    learnerId,
    periodKey,
    used,
  });
}

after(async () => {
  await pool.end();
});

test("Free requests at the monthly cap receive 429 without calling the AI", async () => {
  await withLearner("free", async (learner) => {
    const periodKey = "2026-09";
    await setUsage(learner.learnerId, periodKey, FREE_COACHING_MONTHLY_LIMIT);
    let aiCalls = 0;

    const outcome = await executePracticeCoachingRequest(
      learner,
      async () => {
        aiCalls += 1;
        return "Should not be called";
      },
      testNow,
    );

    assert.equal(outcome.status, 429);
    assert.equal(aiCalls, 0);
    if (outcome.status === 429) {
      assert.equal(outcome.usage.used, FREE_COACHING_MONTHLY_LIMIT);
      assert.equal(outcome.usage.remaining, 0);
    }
  });
});

test("Pro requests at the monthly cap receive 429 without calling the AI", async () => {
  await withLearner("pro", async (learner) => {
    const periodKey = "2026-09";
    await setUsage(learner.learnerId, periodKey, PRO_COACHING_MONTHLY_LIMIT);
    let aiCalls = 0;

    const outcome = await executePracticeCoachingRequest(
      learner,
      async () => {
        aiCalls += 1;
        return "Should not be called";
      },
      testNow,
    );

    assert.equal(outcome.status, 429);
    assert.equal(aiCalls, 0);
    if (outcome.status === 429) {
      assert.equal(outcome.usage.used, PRO_COACHING_MONTHLY_LIMIT);
      assert.equal(outcome.usage.remaining, 0);
    }
  });
});

test("concurrent Free and Pro reservations never exceed their monthly limits", async () => {
  for (const plan of ["free", "pro"] as const) {
    const monthlyLimit =
      plan === "pro"
        ? PRO_COACHING_MONTHLY_LIMIT
        : FREE_COACHING_MONTHLY_LIMIT;

    await withLearner(plan, async (learner) => {
      const attempts = monthlyLimit + 10;
      const reservations = await Promise.all(
        Array.from({ length: attempts }, () =>
          reservePracticeCoachingRequest(learner, testNow),
        ),
      );

      assert.equal(
        reservations.filter((reservation) => reservation !== null).length,
        monthlyLimit,
      );
      assert.equal(
        (await getPracticeUsage(learner, testNow)).used,
        monthlyLimit,
      );
    });
  }
});

test("failed AI requests release their reserved usage", async () => {
  await withLearner("free", async (learner) => {
    let aiCalls = 0;

    const outcome = await executePracticeCoachingRequest(
      learner,
      async () => {
        aiCalls += 1;
        throw new Error("simulated provider failure");
      },
      testNow,
    );

    assert.equal(outcome.status, 503);
    assert.equal(aiCalls, 1);
    assert.equal((await getPracticeUsage(learner, testNow)).used, 0);
  });
});

test("empty AI feedback releases its reserved usage", async () => {
  await withLearner("free", async (learner) => {
    const outcome = await executePracticeCoachingRequest(
      learner,
      async () => "   ",
      testNow,
    );

    assert.equal(outcome.status, 503);
    assert.equal((await getPracticeUsage(learner, testNow)).used, 0);
  });
});

test("the UTC month rollover starts a fresh allowance", async () => {
  await withLearner("free", async (learner) => {
    const lastMomentOfSeptember = new Date("2026-09-30T23:59:59.999Z");
    const firstMomentOfOctober = new Date("2026-10-01T00:00:00.000Z");

    for (let index = 0; index < FREE_COACHING_MONTHLY_LIMIT; index += 1) {
      const reservation = await reservePracticeCoachingRequest(
        learner,
        lastMomentOfSeptember,
      );
      assert.ok(reservation);
    }

    const freshMonthReservation = await reservePracticeCoachingRequest(
      learner,
      firstMomentOfOctober,
    );

    assert.ok(freshMonthReservation);
    assert.equal(freshMonthReservation.periodKey, "2026-10");
    assert.equal(freshMonthReservation.usage.used, 1);
    assert.equal(freshMonthReservation.usage.remaining, FREE_COACHING_MONTHLY_LIMIT - 1);
    assert.equal(
      (await getPracticeUsage(learner, firstMomentOfOctober)).used,
      1,
    );
  });
});

async function expire(reservationId: string) {
  await db.update(reservations).set({ expiresAt: new Date(0) })
    .where(eq(reservations.reservationId, reservationId));
}

test("release-write failure survives rollback and is durably recovered exactly once", async () => {
  await withLearner("free", async learner => {
    const transaction = db.transaction.bind(db);
    let restore = () => {};
    try {
      const outcome = await executePracticeCoachingRequest(learner, async () => {
        // Real PostgreSQL rejects the release UPDATE; the prior reservation
        // remains committed. No in-memory retry queue participates in recovery.
        const mocked = mock.method(db, "transaction", (callback: Parameters<typeof db.transaction>[0]) =>
          transaction(async tx => {
            await tx.execute(sql`SET TRANSACTION READ ONLY`);
            return callback(tx);
          }));
        restore = () => mocked.mock.restore();
        throw new Error("provider failed");
      }, testNow);
      assert.equal(outcome.status, 503);
      assert.ok(outcome.status === 503 && outcome.releaseError);
    } finally {
      restore();
    }
    const [pending] = await db.select().from(reservations).where(eq(reservations.learnerId, learner.learnerId));
    assert.equal(pending.status, "pending");
    assert.equal((await getPracticeUsage(learner, testNow)).used, 1);
    await expire(pending.reservationId);
    await Promise.all([
      reconcilePracticeCoachingReservations(),
      reconcilePracticeCoachingReservations(),
      releasePracticeCoachingRequest(pending.reservationId),
    ]);
    assert.equal((await getPracticeUsage(learner, testNow)).used, 0);
    await releasePracticeCoachingRequest(pending.reservationId);
    assert.equal((await getPracticeUsage(learner, testNow)).used, 0);
  });
});

test("successful requests cannot be refunded by release or expired recovery", async () => {
  await withLearner("free", async learner => {
    const result = await executePracticeCoachingRequest(learner, async () => "Helpful feedback", testNow);
    assert.equal(result.status, 200);
    if (result.status !== 200) return;
    await expire(result.reservation.reservationId);
    await Promise.all([
      releasePracticeCoachingRequest(result.reservation.reservationId),
      reconcilePracticeCoachingReservations(),
    ]);
    assert.equal((await getPracticeUsage(learner, testNow)).used, 1);
  });
});

test("late AI results fail closed and refund only their original month", async () => {
  await withLearner("free", async learner => {
    await setUsage(learner.learnerId, "2026-10", 3);
    const outcome = await executePracticeCoachingRequest(learner, async () => {
      const [pending] = await db.select().from(reservations).where(eq(reservations.learnerId, learner.learnerId));
      await expire(pending.reservationId);
      await reconcilePracticeCoachingReservations();
      return "Too late";
    }, testNow);
    assert.equal(outcome.status, 503);
    assert.equal((await getPracticeUsage(learner, testNow)).used, 0);
    assert.equal((await getPracticeUsage(learner, new Date("2026-10-01"))).used, 3);
  });
});

test("completion and release races settle a reservation once", async () => {
  await withLearner("free", async learner => {
    const reservation = await reservePracticeCoachingRequest(learner, testNow);
    assert.ok(reservation);
    await Promise.allSettled([
      completePracticeCoachingRequest(reservation.reservationId),
      releasePracticeCoachingRequest(reservation.reservationId),
    ]);
    const [settled] = await db.select().from(reservations)
      .where(eq(reservations.reservationId, reservation.reservationId));
    assert.ok(["succeeded", "released"].includes(settled.status));
    const expected = settled.status === "succeeded" ? 1 : 0;
    await expire(reservation.reservationId);
    await reconcilePracticeCoachingReservations();
    assert.equal((await getPracticeUsage(learner, testNow)).used, expected);
  });
});

test("an expired reservation is reclaimed before enforcing the monthly cap", async () => {
  await withLearner("free", async learner => {
    await setUsage(learner.learnerId, "2026-09", FREE_COACHING_MONTHLY_LIMIT - 1);
    const abandoned = await reservePracticeCoachingRequest(learner, testNow);
    assert.ok(abandoned);
    await expire(abandoned.reservationId);
    const replacement = await reservePracticeCoachingRequest(learner, testNow);
    assert.ok(replacement);
    assert.equal(replacement.usage.used, FREE_COACHING_MONTHLY_LIMIT);
  });
});