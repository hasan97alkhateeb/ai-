import {
  COACHING_MAINTENANCE_STALE_WARNING_AGE_MS,
  COACHING_RESERVATION_PRUNE_BATCH_SIZE,
  COACHING_RESERVATION_RECOVERY_BATCH_SIZE,
  COACHING_RESERVATION_RECOVERY_WARNING_AGE_MS,
  COACHING_RESERVATION_RETENTION_DAYS,
  COACHING_RESERVATION_RETENTION_WARNING_AGE_MS,
  type PracticeCoachingMaintenanceSnapshot,
} from "./practice-reservations";

const DAY_MS = 24 * 60 * 60 * 1000;

export type PracticeCoachingMaintenanceWarning = {
  check: "coaching-reservation-recovery" | "coaching-reservation-retention";
  reasons: string[];
  fields: Record<string, unknown>;
  message: string;
};

export type PracticeCoachingMaintenanceMonitorContext = {
  now: number;
  processStartedAt: number;
  recoveryStartedAt: number | null;
  retentionStartedAt: number | null;
};

export function getPracticeCoachingMaintenanceWarnings(
  snapshot: PracticeCoachingMaintenanceSnapshot,
  context: PracticeCoachingMaintenanceMonitorContext,
): PracticeCoachingMaintenanceWarning[] {
  const warnings: PracticeCoachingMaintenanceWarning[] = [];
  const recoveryReferenceAt = Math.max(
    snapshot.lastSuccessfulRecoveryAt?.getTime() ?? context.processStartedAt,
    context.recoveryStartedAt ?? Number.MIN_SAFE_INTEGER,
  );
  const retentionReferenceAt = Math.max(
    snapshot.lastSuccessfulRetentionAt?.getTime() ?? context.processStartedAt,
    context.retentionStartedAt ?? Number.MIN_SAFE_INTEGER,
  );
  const recoverySinceSuccessMs = context.now - recoveryReferenceAt;
  const retentionSinceSuccessMs = context.now - retentionReferenceAt;
  const oldestExpiredPendingAgeMs = snapshot.oldestExpiredPendingAt
    ? context.now - snapshot.oldestExpiredPendingAt.getTime()
    : null;
  const oldestEligibleHistoryAgeMs = snapshot.oldestEligibleHistoryAt
    ? context.now - snapshot.oldestEligibleHistoryAt.getTime()
    : null;
  const historyOverdueThresholdMs =
    COACHING_RESERVATION_RETENTION_DAYS * DAY_MS +
    COACHING_RESERVATION_RETENTION_WARNING_AGE_MS;

  const recoveryReasons: string[] = [];
  if (snapshot.expiredPendingBacklogAtLeast > COACHING_RESERVATION_RECOVERY_BATCH_SIZE) {
    recoveryReasons.push("backlog-exceeds-batch");
  }
  if (
    oldestExpiredPendingAgeMs !== null &&
    oldestExpiredPendingAgeMs >= COACHING_RESERVATION_RECOVERY_WARNING_AGE_MS
  ) {
    recoveryReasons.push("oldest-expired-reservation-is-overdue");
  }
  if (recoverySinceSuccessMs >= COACHING_MAINTENANCE_STALE_WARNING_AGE_MS) {
    recoveryReasons.push("last-success-is-stale");
  }
  if (recoveryReasons.length) {
    warnings.push({
      check: "coaching-reservation-recovery",
      reasons: recoveryReasons,
      fields: {
        expiredPendingBacklogAtLeast: snapshot.expiredPendingBacklogAtLeast,
        recoveryBatchSize: COACHING_RESERVATION_RECOVERY_BATCH_SIZE,
        oldestExpiredPendingAt: snapshot.oldestExpiredPendingAt,
        oldestExpiredPendingAgeMs,
        lastSuccessfulRunAt: snapshot.lastSuccessfulRecoveryAt,
        timeSinceSuccessfulRunMs: recoverySinceSuccessMs,
      },
      message: "Coaching reservation recovery is behind; inspect database availability and recovery logs",
    });
  }

  const retentionReasons: string[] = [];
  if (snapshot.eligibleHistoryBacklogAtLeast > COACHING_RESERVATION_PRUNE_BATCH_SIZE) {
    retentionReasons.push("backlog-exceeds-batch");
  }
  if (
    oldestEligibleHistoryAgeMs !== null &&
    oldestEligibleHistoryAgeMs >= historyOverdueThresholdMs
  ) {
    retentionReasons.push("oldest-settlement-is-overdue");
  }
  if (retentionSinceSuccessMs >= COACHING_MAINTENANCE_STALE_WARNING_AGE_MS) {
    retentionReasons.push("last-success-is-stale");
  }
  if (retentionReasons.length) {
    warnings.push({
      check: "coaching-reservation-retention",
      reasons: retentionReasons,
      fields: {
        eligibleHistoryBacklogAtLeast: snapshot.eligibleHistoryBacklogAtLeast,
        pruneBatchSize: COACHING_RESERVATION_PRUNE_BATCH_SIZE,
        oldestEligibleHistoryAt: snapshot.oldestEligibleHistoryAt,
        oldestEligibleHistoryAgeMs,
        retentionDays: COACHING_RESERVATION_RETENTION_DAYS,
        overdueWarningAgeMs: COACHING_RESERVATION_RETENTION_WARNING_AGE_MS,
        lastSuccessfulRunAt: snapshot.lastSuccessfulRetentionAt,
        timeSinceSuccessfulRunMs: retentionSinceSuccessMs,
      },
      message: "Coaching reservation retention is behind; inspect database availability and retention logs",
    });
  }

  return warnings;
}