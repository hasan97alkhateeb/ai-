import { and, asc, eq, lte, lt, sql } from "drizzle-orm";
import {
  db,
  practiceCoachingMaintenanceTable as maintenance,
  practiceCoachingReservationsTable as reservations,
  practiceCoachingUsageTable as usage,
} from "@workspace/db";
import { lockPracticeLinks } from "./practice-link-lock";

// A bounded lease also recovers failures where no further database write is
// possible, including process termination. Late AI results cannot commit.
export const COACHING_RESERVATION_LEASE_MS = 10 * 60 * 1000;
export const COACHING_RESERVATION_RETENTION_DAYS = 90;
export const COACHING_RESERVATION_RECOVERY_BATCH_SIZE = 100;
export const COACHING_RESERVATION_PRUNE_BATCH_SIZE = 500;
export const COACHING_RESERVATION_RECOVERY_WARNING_AGE_MS = 5 * 60 * 1000;
export const COACHING_RESERVATION_RETENTION_WARNING_AGE_MS = 24 * 60 * 60 * 1000;
export const COACHING_MAINTENANCE_STALE_WARNING_AGE_MS = 5 * 60 * 1000;
export const COACHING_MAINTENANCE_PROBE_INTERVAL_MS = 5 * 60 * 1000;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PracticeCoachingMaintenanceSnapshot = {
  expiredPendingBacklogAtLeast: number;
  oldestExpiredPendingAt: Date | null;
  eligibleHistoryBacklogAtLeast: number;
  oldestEligibleHistoryAt: Date | null;
  lastSuccessfulRecoveryAt: Date | null;
  lastSuccessfulRetentionAt: Date | null;
};

type PracticeCoachingMaintenanceJob = "reservation-recovery" | "reservation-retention";

async function recordMaintenanceSuccess(
  tx: Transaction,
  job: PracticeCoachingMaintenanceJob,
) {
  await tx.insert(maintenance)
    .values({ job, lastSuccessfulAt: sql`clock_timestamp()` })
    .onConflictDoUpdate({
      target: maintenance.job,
      set: { lastSuccessfulAt: sql`clock_timestamp()` },
    });
}

async function refund(tx: Transaction, reservation: typeof reservations.$inferSelect) {
  const [updated] = await tx.update(usage).set({
    used: sql`${usage.used} - 1`,
    updatedAt: new Date(),
  }).where(and(
    eq(usage.learnerId, reservation.learnerId),
    eq(usage.periodKey, reservation.periodKey),
    sql`${usage.used} > 0`,
  )).returning();
  if (!updated) throw new Error("Missing usage for coaching reservation");
}

export async function releasePracticeCoachingRequest(reservationId: string): Promise<void> {
  await db.transaction(async tx => {
    await lockPracticeLinks(tx);
    const [released] = await tx.update(reservations).set({ status: "released", settledAt: sql`clock_timestamp()` })
      .where(and(eq(reservations.reservationId, reservationId), eq(reservations.status, "pending")))
      .returning();
    if (released) await refund(tx, released);
  });
}

export async function completePracticeCoachingRequest(
  reservationId: string,
  persistSuccessfulAttempt?: (tx: Transaction) => Promise<void>,
): Promise<void> {
  const settle = async (tx: Transaction): Promise<void> => {
    const [completed] = await tx.update(reservations)
      .set({ status: "succeeded", settledAt: sql`clock_timestamp()` })
      .where(and(
        eq(reservations.reservationId, reservationId),
        eq(reservations.status, "pending"),
        sql`${reservations.expiresAt} > clock_timestamp()`,
      )).returning();
    if (!completed) throw new Error("Coaching reservation expired or already settled");
    await persistSuccessfulAttempt?.(tx);
  };

  if (persistSuccessfulAttempt) {
    await db.transaction(settle);
    return;
  }

  const [completed] = await db.update(reservations)
    .set({ status: "succeeded", settledAt: sql`clock_timestamp()` })
    .where(and(
      eq(reservations.reservationId, reservationId),
      eq(reservations.status, "pending"),
      sql`${reservations.expiresAt} > clock_timestamp()`,
    )).returning();
  if (!completed) throw new Error("Coaching reservation expired or already settled");
}

export async function reconcilePracticeCoachingReservations(): Promise<number> {
  return db.transaction(async tx => {
    await lockPracticeLinks(tx);
    // Bounded batches avoid holding the account-link lock for a large backlog.
    const expired = await tx.select().from(reservations).where(and(
      eq(reservations.status, "pending"),
      sql`${reservations.expiresAt} <= clock_timestamp()`,
    )).limit(COACHING_RESERVATION_RECOVERY_BATCH_SIZE).for("update");
    for (const reservation of expired) {
      await tx.update(reservations).set({ status: "released", settledAt: sql`clock_timestamp()` })
        .where(eq(reservations.reservationId, reservation.reservationId));
      await refund(tx, reservation);
    }
    await recordMaintenanceSuccess(tx, "reservation-recovery");
    return expired.length;
  });
}

// These probes use the recovery and retention indexes and cap every result at
// one row beyond the corresponding worker batch. They run on a timer, not on
// learner requests, and report a lower bound once a batch is exceeded.
export async function inspectPracticeCoachingMaintenance(): Promise<PracticeCoachingMaintenanceSnapshot> {
  const settledCutoff = sql`statement_timestamp() - make_interval(days => ${COACHING_RESERVATION_RETENTION_DAYS})`;
  const [expiredPending, succeededHistory, releasedHistory, maintenanceRuns] = await Promise.all([
    db.select({ expiresAt: reservations.expiresAt })
      .from(reservations)
      .where(and(
        eq(reservations.status, "pending"),
        lte(reservations.expiresAt, sql`clock_timestamp()`),
      ))
      .orderBy(asc(reservations.expiresAt))
      .limit(COACHING_RESERVATION_RECOVERY_BATCH_SIZE + 1),
    db.select({ settledAt: reservations.settledAt })
      .from(reservations)
      .where(and(eq(reservations.status, "succeeded"), lt(reservations.settledAt, settledCutoff)))
      .orderBy(asc(reservations.settledAt), asc(reservations.reservationId))
      .limit(COACHING_RESERVATION_PRUNE_BATCH_SIZE + 1),
    db.select({ settledAt: reservations.settledAt })
      .from(reservations)
      .where(and(eq(reservations.status, "released"), lt(reservations.settledAt, settledCutoff)))
      .orderBy(asc(reservations.settledAt), asc(reservations.reservationId))
      .limit(COACHING_RESERVATION_PRUNE_BATCH_SIZE + 1),
    db.select({
      job: maintenance.job,
      lastSuccessfulAt: maintenance.lastSuccessfulAt,
    }).from(maintenance),
  ]);
  const oldestEligibleHistoryAt = [succeededHistory[0]?.settledAt, releasedHistory[0]?.settledAt]
    .filter((value): value is Date => value !== undefined)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  return {
    expiredPendingBacklogAtLeast: Math.min(
      expiredPending.length,
      COACHING_RESERVATION_RECOVERY_BATCH_SIZE + 1,
    ),
    oldestExpiredPendingAt: expiredPending[0]?.expiresAt ?? null,
    eligibleHistoryBacklogAtLeast: Math.min(
      succeededHistory.length + releasedHistory.length,
      COACHING_RESERVATION_PRUNE_BATCH_SIZE + 1,
    ),
    oldestEligibleHistoryAt,
    lastSuccessfulRecoveryAt: maintenanceRuns.find(
      run => run.job === "reservation-recovery",
    )?.lastSuccessfulAt ?? null,
    lastSuccessfulRetentionAt: maintenanceRuns.find(
      run => run.job === "reservation-retention",
    )?.lastSuccessfulAt ?? null,
  };
}

// Delete only terminal history, never usage or pending leases. Row locks and a
// single statement make concurrent workers safe without the account-link lock.
// Missing IDs remain safe: release is a no-op; completion rejects (fail closed).
export async function prunePracticeCoachingReservations(): Promise<number> {
  return db.transaction(async tx => {
    const result = await tx.execute(sql`
      WITH expired_history AS (
        SELECT reservation_id FROM ${reservations}
        WHERE status IN ('succeeded', 'released')
          AND settled_at < statement_timestamp() - make_interval(days => ${COACHING_RESERVATION_RETENTION_DAYS})
        ORDER BY status, settled_at, reservation_id
        LIMIT ${COACHING_RESERVATION_PRUNE_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM ${reservations} AS history
      USING expired_history
      WHERE history.reservation_id = expired_history.reservation_id
      RETURNING history.reservation_id
    `);
    await recordMaintenanceSuccess(tx, "reservation-retention");
    return result.rowCount ?? 0;
  });
}