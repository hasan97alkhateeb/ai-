import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db, pool, practiceLearnersTable as learners, practiceCoachingUsageTable as usage, practiceCoachingReservationsTable as reservations } from "@workspace/db";
import {
  COACHING_RESERVATION_PRUNE_BATCH_SIZE,
  COACHING_RESERVATION_RETENTION_DAYS,
  completePracticeCoachingRequest,
  inspectPracticeCoachingMaintenance,
  releasePracticeCoachingRequest,
  reconcilePracticeCoachingReservations,
  prunePracticeCoachingReservations,
} from "./practice-reservations";

after(() => pool.end());

test("retention is bounded, preserves support history and usage, and fails closed for deleted IDs", async () => {
  const learnerId = randomUUID();
  await db.insert(learners).values({ learnerId });
  try {
    const periodKey = "2020-01";
    await db.insert(usage).values({ learnerId, periodKey, used: 42 });
    const old = new Date(Date.now() - (COACHING_RESERVATION_RETENTION_DAYS + 1) * 86_400_000);
    const recent = new Date(Date.now() - (COACHING_RESERVATION_RETENTION_DAYS - 1) * 86_400_000);
    const future = new Date(Date.now() + 60_000);
    const ids = Array.from({ length: COACHING_RESERVATION_PRUNE_BATCH_SIZE + 5 }, () => randomUUID());
    await db.insert(reservations).values(ids.map((reservationId, i) => ({
      reservationId, learnerId, periodKey,
      status: i % 2 ? "succeeded" as const : "released" as const,
      expiresAt: old, settledAt: old,
    })));
    const pending = randomUUID();
    const succeeded = randomUUID();
    const released = randomUUID();
    const legacy = randomUUID();
    await db.insert(reservations).values([
      { reservationId: pending, learnerId, periodKey, status: "pending", expiresAt: future, settledAt: old },
      { reservationId: succeeded, learnerId, periodKey, status: "succeeded", expiresAt: old, settledAt: recent },
      { reservationId: released, learnerId, periodKey, status: "released", expiresAt: old, settledAt: recent },
      { reservationId: legacy, learnerId, periodKey, status: "succeeded", expiresAt: old },
    ]);
    const initialMaintenance = await inspectPracticeCoachingMaintenance();
    assert.equal(initialMaintenance.expiredPendingBacklogAtLeast, 0);
    assert.equal(initialMaintenance.eligibleHistoryBacklogAtLeast, COACHING_RESERVATION_PRUNE_BATCH_SIZE + 1);
    assert.ok(initialMaintenance.oldestEligibleHistoryAt);
    assert.ok(initialMaintenance.oldestEligibleHistoryAt <= old);

    const totals = () => db.select().from(usage).where(eq(usage.learnerId, learnerId));
    const before = await totals();
    assert.equal(await prunePracticeCoachingReservations(), COACHING_RESERVATION_PRUNE_BATCH_SIZE);
    const counts = await Promise.all([prunePracticeCoachingReservations(), prunePracticeCoachingReservations()]);
    assert.equal(counts.reduce((a, b) => a + b, 0), 5);
    assert.equal(await prunePracticeCoachingReservations(), 0);
    assert.deepEqual(await totals(), before);
    const retained = await db.select().from(reservations).where(eq(reservations.learnerId, learnerId));
    assert.deepEqual(retained.map(r => r.reservationId).sort(), [pending, succeeded, released, legacy].sort());

    // Repeat both settlement operations for deleted successes and releases.
    for (const id of ids.slice(0, 2)) {
      await releasePracticeCoachingRequest(id);
      await releasePracticeCoachingRequest(id);
      await assert.rejects(completePracticeCoachingRequest(id), /expired or already settled/);
    }
    assert.deepEqual(await totals(), before);

    // Old pending leases survive pruning, then get a fresh support window on recovery.
    await db.update(reservations).set({ expiresAt: old }).where(eq(reservations.reservationId, pending));
    const expiredMaintenance = await inspectPracticeCoachingMaintenance();
    assert.equal(expiredMaintenance.expiredPendingBacklogAtLeast, 1);
    assert.equal(expiredMaintenance.oldestExpiredPendingAt?.getTime(), old.getTime());
    assert.equal(await prunePracticeCoachingReservations(), 0);
    await reconcilePracticeCoachingReservations();
    const [recovered] = await db.select().from(reservations).where(eq(reservations.reservationId, pending));
    assert.equal(recovered.status, "released");
    assert.ok(recovered.settledAt > recent);
    assert.equal(await prunePracticeCoachingReservations(), 0);
    assert.equal((await totals())[0].used, 41);
    await releasePracticeCoachingRequest(pending);
    assert.equal((await totals())[0].used, 41);

    // Both normal settlement paths overwrite an old placeholder timestamp.
    for (const settle of [completePracticeCoachingRequest, releasePracticeCoachingRequest]) {
      const reservationId = randomUUID();
      await db.insert(reservations).values({ reservationId, learnerId, periodKey, expiresAt: future, settledAt: old });
      await settle(reservationId);
      const [row] = await db.select().from(reservations).where(eq(reservations.reservationId, reservationId));
      assert.ok(row.settledAt > recent);
    }
    assert.equal(await prunePracticeCoachingReservations(), 0);

    // A busy terminal row is skipped, not waited on or lost.
    await db.update(reservations).set({ settledAt: old }).where(eq(reservations.reservationId, legacy));
    await db.transaction(async tx => {
      await tx.execute(sql`SELECT reservation_id FROM ${reservations} WHERE reservation_id = ${legacy} FOR UPDATE`);
      assert.equal(await prunePracticeCoachingReservations(), 0);
    });
    assert.equal(await prunePracticeCoachingReservations(), 1);
  } finally {
    await db.delete(learners).where(eq(learners.learnerId, learnerId));
  }
});