import assert from "node:assert/strict";
import test from "node:test";
import {
  COACHING_MAINTENANCE_STALE_WARNING_AGE_MS,
  COACHING_RESERVATION_PRUNE_BATCH_SIZE,
  COACHING_RESERVATION_RECOVERY_BATCH_SIZE,
  COACHING_RESERVATION_RECOVERY_WARNING_AGE_MS,
  COACHING_RESERVATION_RETENTION_DAYS,
  COACHING_RESERVATION_RETENTION_WARNING_AGE_MS,
  inspectPracticeCoachingMaintenance,
  prunePracticeCoachingReservations,
  reconcilePracticeCoachingReservations,
} from "./practice-reservations";
import {
  db,
  pool,
  practiceCoachingMaintenanceTable as maintenance,
} from "@workspace/db";
import { getPracticeCoachingMaintenanceWarnings } from "./practice-maintenance-monitor";
import type { PracticeCoachingMaintenanceSnapshot } from "./practice-reservations";

const now = Date.UTC(2026, 8, 30, 12);
const recentRun = new Date(now - 1_000);

function makeSnapshot(
  overrides: Partial<PracticeCoachingMaintenanceSnapshot> = {},
): PracticeCoachingMaintenanceSnapshot {
  return {
    expiredPendingBacklogAtLeast: 0,
    oldestExpiredPendingAt: null,
    eligibleHistoryBacklogAtLeast: 0,
    oldestEligibleHistoryAt: null,
    lastSuccessfulRecoveryAt: recentRun,
    lastSuccessfulRetentionAt: recentRun,
    ...overrides,
  };
}

function evaluate(
  snapshot: PracticeCoachingMaintenanceSnapshot = makeSnapshot(),
  overrides: Partial<Parameters<typeof getPracticeCoachingMaintenanceWarnings>[1]> = {},
) {
  return getPracticeCoachingMaintenanceWarnings(snapshot, {
    now,
    processStartedAt: now - 500,
    recoveryStartedAt: null,
    retentionStartedAt: null,
    ...overrides,
  });
}

test("maintenance warnings stay quiet below every threshold", () => {
  assert.deepEqual(evaluate(), []);
});

test("recovery warns only when the capped backlog exceeds its batch", () => {
  assert.deepEqual(evaluate(makeSnapshot({
    expiredPendingBacklogAtLeast: COACHING_RESERVATION_RECOVERY_BATCH_SIZE,
  })), []);
  const warnings = evaluate(makeSnapshot({
    expiredPendingBacklogAtLeast: COACHING_RESERVATION_RECOVERY_BATCH_SIZE + 1,
  }));
  assert.equal(warnings[0]?.check, "coaching-reservation-recovery");
  assert.deepEqual(warnings[0]?.reasons, ["backlog-exceeds-batch"]);
});

test("recovery warns at the exact expired-reservation age threshold", () => {
  const warnings = evaluate(makeSnapshot({
    oldestExpiredPendingAt: new Date(now - COACHING_RESERVATION_RECOVERY_WARNING_AGE_MS),
  }));
  assert.deepEqual(warnings[0]?.reasons, ["oldest-expired-reservation-is-overdue"]);
});

test("maintenance heartbeat warnings use durable success times across process restarts", () => {
  const lastSuccess = new Date(now - COACHING_MAINTENANCE_STALE_WARNING_AGE_MS);
  const warnings = evaluate(makeSnapshot({
    lastSuccessfulRecoveryAt: lastSuccess,
    lastSuccessfulRetentionAt: lastSuccess,
  }), {
    processStartedAt: now - 100,
  });
  assert.deepEqual(warnings.map(warning => warning.check), [
    "coaching-reservation-recovery",
    "coaching-reservation-retention",
  ]);
  assert.deepEqual(
    warnings.map(warning => warning.fields.lastSuccessfulRunAt),
    [lastSuccess, lastSuccess],
  );
  assert.deepEqual(
    warnings.map(warning => warning.fields.timeSinceSuccessfulRunMs),
    [
      COACHING_MAINTENANCE_STALE_WARNING_AGE_MS,
      COACHING_MAINTENANCE_STALE_WARNING_AGE_MS,
    ],
  );
});

test("an in-flight recovery gets a grace window, then warns if it remains stuck", () => {
  const snapshot = makeSnapshot({
    lastSuccessfulRecoveryAt: new Date(now - COACHING_MAINTENANCE_STALE_WARNING_AGE_MS * 3),
  });
  assert.deepEqual(evaluate(snapshot, {
    recoveryStartedAt: now - 1_000,
  }), []);
  const warnings = evaluate(snapshot, {
    recoveryStartedAt: now - COACHING_MAINTENANCE_STALE_WARNING_AGE_MS,
  });
  assert.equal(warnings[0]?.check, "coaching-reservation-recovery");
  assert.deepEqual(warnings[0]?.reasons, ["last-success-is-stale"]);
});

test("retention warns only when its capped backlog exceeds its batch", () => {
  assert.deepEqual(evaluate(makeSnapshot({
    eligibleHistoryBacklogAtLeast: COACHING_RESERVATION_PRUNE_BATCH_SIZE,
  })), []);
  const warnings = evaluate(makeSnapshot({
    eligibleHistoryBacklogAtLeast: COACHING_RESERVATION_PRUNE_BATCH_SIZE + 1,
  }));
  assert.equal(warnings[0]?.check, "coaching-reservation-retention");
  assert.deepEqual(warnings[0]?.reasons, ["backlog-exceeds-batch"]);
});

test("retention warns at the exact retention-plus-grace threshold", () => {
  const overdueAge =
    COACHING_RESERVATION_RETENTION_DAYS * 24 * 60 * 60 * 1000 +
    COACHING_RESERVATION_RETENTION_WARNING_AGE_MS;
  const warnings = evaluate(makeSnapshot({
    oldestEligibleHistoryAt: new Date(now - overdueAge),
  }));
  assert.equal(warnings[0]?.check, "coaching-reservation-retention");
  assert.deepEqual(warnings[0]?.reasons, ["oldest-settlement-is-overdue"]);
});

test("successful maintenance timestamps are durable and visible to a fresh probe", async () => {
  await db.delete(maintenance);
  try {
    await reconcilePracticeCoachingReservations();
    await prunePracticeCoachingReservations();

    const freshSnapshot = await inspectPracticeCoachingMaintenance();
    assert.ok(freshSnapshot.lastSuccessfulRecoveryAt instanceof Date);
    assert.ok(freshSnapshot.lastSuccessfulRetentionAt instanceof Date);
  } finally {
    await db.delete(maintenance);
  }
});

test.after(async () => pool.end());