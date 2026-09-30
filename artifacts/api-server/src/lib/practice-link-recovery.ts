import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, ne, or, sql } from "drizzle-orm";
import {
  db, practiceLearnersTable as learners, practiceLinkConflictsTable as cases,
  practiceLinkAuditTable as audits, practiceRetiredMembershipsTable as retired,
  practiceLearnerAliasesTable as aliases, practiceCoachingUsageTable as usage,
  practiceCoachingReservationsTable as reservations,
  practiceAttemptsTable as attempts,
  practiceCheckoutSessionsTable as checkouts,
} from "@workspace/db";
import { lockPracticeLinks, type PracticeTransaction } from "./practice-link-lock";
import { corroborateRecoveryMemberships } from "./practice-recovery-whop";

export type RecoveryEvidence = {
  ticket: string;
  authUserId: string;
  canonicalLearnerId: string;
  retainedMembershipId: string;
  ownership: { membershipId: string; whopUserId: string; verifiedOwnerAuthUserId: string; evidenceReference: string; method: "provider_dashboard_and_authenticated_customer"; verifiedAt: string }[];
  ended: { membershipId: string; status: "canceled" | "expired"; recurringBillingDisabled: true; accessEnded: true; endedAt: string; verifiedAt: string; providerRecordReference: string };
};
function required(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length < 3) throw new Error(`${name} is required.`);
}
function fresh(value: string, now: Date) {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time > now.getTime() || now.getTime() - time > 24 * 60 * 60 * 1000) {
    throw new Error("Verification must be from the last 24 hours, not the future.");
  }
}
export function validateRecoveryEvidence(c: typeof cases.$inferSelect, e: RecoveryEvidence, now = new Date()) {
  required(e.ticket, "Ticket reference");
  if (e.authUserId !== c.authUserId || e.canonicalLearnerId !== c.canonicalLearnerId) throw new Error("Canonical signed-in identity does not match case.");
  const memberships = [c.accountMembershipId, c.anonymousMembershipId];
  if (!memberships.includes(e.retainedMembershipId)) throw new Error("Retained membership is not in this case.");
  if (!Array.isArray(e.ownership) || e.ownership.length !== 2) throw new Error("Verify BOTH memberships independently.");
  for (const id of memberships) {
    const proof = e.ownership.find(p => p.membershipId === id);
    if (!proof || proof.verifiedOwnerAuthUserId !== c.authUserId || proof.method !== "provider_dashboard_and_authenticated_customer") throw new Error("Both memberships require out-of-band ownership verification.");
    required(proof.evidenceReference, "Ownership evidence reference");
    required(proof.whopUserId, "Independently verified Whop buyer ID");
    fresh(proof.verifiedAt, now);
  }
  const ended = e.ended;
  if (!ended || ended.membershipId === e.retainedMembershipId || !memberships.includes(ended.membershipId) ||
      !["canceled", "expired"].includes(ended.status) || ended.recurringBillingDisabled !== true || ended.accessEnded !== true) {
    throw new Error("Duplicate must be ended, not active or canceling at period end.");
  }
  const endedTime = Date.parse(ended.endedAt);
  if (!Number.isFinite(endedTime) || endedTime > now.getTime()) throw new Error("Duplicate access has not ended.");
  fresh(ended.verifiedAt, now);
  required(ended.providerRecordReference, "Provider termination evidence reference");
}
async function audit(tx: PracticeTransaction, conflictId: string, operator: string, action: string, details: unknown) {
  required(operator, "Authenticated operator identity");
  await tx.insert(audits).values({ auditId: randomUUID(), conflictId, operator, action, details });
}
export async function inspectPracticeConflict(conflictId: string, operator: string) {
  return db.transaction(async tx => {
    await lockPracticeLinks(tx);
    const [c] = await tx.select().from(cases).where(eq(cases.conflictId, conflictId));
    if (!c) throw new Error("Unknown conflict.");
    await audit(tx, conflictId, operator, "inspect", {});
    return {
      conflict: c,
      learners: await tx.select().from(learners).where(or(eq(learners.learnerId, c.canonicalLearnerId), eq(learners.learnerId, c.anonymousLearnerId))),
      usage: await tx.select().from(usage).where(or(eq(usage.learnerId, c.canonicalLearnerId), eq(usage.learnerId, c.anonymousLearnerId))),
      audit: await tx.select().from(audits).where(eq(audits.conflictId, conflictId)),
    };
  });
}
export async function recordPracticeConflictEvidence(conflictId: string, operator: string, evidence: RecoveryEvidence) {
  required(operator, "Authenticated operator identity");
  // Do not let callers mutate the evidence while the network read is in flight.
  evidence = structuredClone(evidence);
  const snapshot = await recoverySnapshot(conflictId);
  if (snapshot.c.status !== "pending") throw new Error("Case is not pending.");
  validateRecoveryEvidence(snapshot.c, evidence);
  const startedAt = performance.now();
  const providerChecks = await corroborateRecoveryMemberships(evidence.ownership, evidence.ended);
  return db.transaction(async tx => {
    await lockPracticeLinks(tx);
    const current = await readRecoverySnapshot(tx, conflictId);
    assertRecoverySnapshot(snapshot, current, startedAt);
    const { c } = current;
    validateRecoveryEvidence(c, evidence);
    await tx.update(cases).set({ evidence }).where(eq(cases.conflictId, conflictId));
    await audit(tx, conflictId, operator, "evidence_verified", { ...evidence, providerChecks });
  });
}
async function readRecoverySnapshot(tx: PracticeTransaction, conflictId: string) {
  // xmin detects even an identical evidence replacement or a change-and-revert.
  const [row] = await tx.select({ c: cases, revision: sql<string>`xmin::text` })
    .from(cases).where(eq(cases.conflictId, conflictId));
  if (!row) throw new Error("Unknown conflict.");
  const { c } = row;
  const identities = await tx.select({ learner: learners, revision: sql<string>`xmin::text` }).from(learners)
    .where(or(eq(learners.learnerId, c.canonicalLearnerId), eq(learners.learnerId, c.anonymousLearnerId)))
    .orderBy(learners.learnerId);
  return { ...row, identities };
}
async function recoverySnapshot(conflictId: string) {
  return db.transaction(async tx => {
    await lockPracticeLinks(tx);
    return readRecoverySnapshot(tx, conflictId);
  });
}
function assertRecoverySnapshot(
  before: Awaited<ReturnType<typeof recoverySnapshot>>,
  after: Awaited<ReturnType<typeof recoverySnapshot>>,
  startedAt: number,
) {
  if (!isDeepStrictEqual(before, after)) {
    throw new Error("Recovery evidence or identity changed; re-verify before retrying.");
  }
  // Includes provider latency AND time waiting to reacquire the lock. Never
  // extend freshness by timestamping only the last provider response.
  if (performance.now() - startedAt > 30_000) {
    throw new Error("Live Whop verification is stale; retry recovery.");
  }
}
export async function resolvePracticeConflict(conflictId: string, operator: string, canonicalLearnerId: string, retainedMembershipId: string) {
  required(operator, "Authenticated operator identity");
  const snapshot = await recoverySnapshot(conflictId);
  if (snapshot.c.canonicalLearnerId !== canonicalLearnerId) throw new Error("Explicit canonical approval does not match.");
  if (snapshot.c.status === "resolved") {
    if (snapshot.c.retainedMembershipId !== retainedMembershipId) throw new Error("Case was resolved with a different membership.");
    return snapshot.c;
  }
  if (snapshot.c.status !== "pending") throw new Error("Case is not pending.");
  const evidence = snapshot.c.evidence as RecoveryEvidence;
  if (!evidence) throw new Error("Record verified evidence before approval.");
  validateRecoveryEvidence(snapshot.c, evidence);
  if (evidence.retainedMembershipId !== retainedMembershipId) throw new Error("Explicit membership approval does not match evidence.");
  const startedAt = performance.now();
  // No connection, transaction, or shared link lock is held during provider I/O.
  const providerChecks = await corroborateRecoveryMemberships(evidence.ownership, evidence.ended);
  return db.transaction(async tx => {
    await lockPracticeLinks(tx);
    const [c] = await tx.select().from(cases).where(eq(cases.conflictId, conflictId)).for("update");
    if (!c) throw new Error("Unknown conflict.");
    if (c.canonicalLearnerId !== canonicalLearnerId) throw new Error("Explicit canonical approval does not match.");
    required(operator, "Authenticated operator identity");
    if (c.status === "resolved") {
      if (c.retainedMembershipId !== retainedMembershipId) throw new Error("Case was resolved with a different membership.");
      return c;
    }
    assertRecoverySnapshot(snapshot, await readRecoverySnapshot(tx, conflictId), startedAt);
    validateRecoveryEvidence(c, evidence);
    if (evidence.retainedMembershipId !== retainedMembershipId) throw new Error("Explicit membership approval does not match evidence.");
    const [account] = await tx.select().from(learners).where(eq(learners.learnerId, c.canonicalLearnerId)).for("update");
    const [anonymous] = await tx.select().from(learners).where(eq(learners.learnerId, c.anonymousLearnerId)).for("update");
    if (!account || !anonymous || account.authUserId !== c.authUserId || anonymous.authUserId !== null ||
        account.whopMembershipId !== c.accountMembershipId || anonymous.whopMembershipId !== c.anonymousMembershipId) {
      throw new Error("Case identity changed; escalate for re-verification.");
    }
    const [other] = await tx.select().from(cases).where(and(eq(cases.status, "pending"),
      eq(cases.anonymousLearnerId, c.anonymousLearnerId), ne(cases.conflictId, conflictId)));
    if (other) throw new Error("Another pending claim requires investigation.");
    const retained = retainedMembershipId === account.whopMembershipId ? account : anonymous;
    const retiredId = evidence.ended.membershipId;
    const duplicate = retiredId === account.whopMembershipId ? account : anonymous;
    if (duplicate.whopLastEventAt && duplicate.whopLastEventAt.getTime() > Date.parse(evidence.ended.verifiedAt)) {
      throw new Error("Duplicate received a newer provider event; re-verify termination before approval.");
    }
    await audit(tx, conflictId, operator, "approved_and_resolved", {
      canonicalLearnerId, retainedMembershipId, evidence, providerChecks, before: { account, anonymous },
      usage: await tx.select().from(usage).where(or(eq(usage.learnerId, account.learnerId), eq(usage.learnerId, anonymous.learnerId))),
    });
    await tx.insert(retired).values({ membershipId: retiredId, conflictId, canonicalLearnerId });
    await tx.update(learners).set({ whopMembershipId: null, plan: "free", whopStatus: "retired" }).where(eq(learners.learnerId, anonymous.learnerId));
    await tx.update(learners).set({
      whopMembershipId: retainedMembershipId, plan: retained.plan,
      whopCheckoutConfigurationId: retained.whopCheckoutConfigurationId, whopPlanId: retained.whopPlanId,
      whopStatus: retained.whopStatus, whopCurrentPeriodEnd: retained.whopCurrentPeriodEnd,
      whopManageUrl: retained.whopManageUrl, whopRecoveryUrl: retained.whopRecoveryUrl, whopLastEventAt: retained.whopLastEventAt,
    }).where(eq(learners.learnerId, canonicalLearnerId));
    for (const row of await tx.select().from(usage).where(eq(usage.learnerId, anonymous.learnerId)).for("update")) {
      await tx.insert(usage).values({ learnerId: canonicalLearnerId, periodKey: row.periodKey, used: row.used })
        .onConflictDoUpdate({ target: [usage.learnerId, usage.periodKey], set: { used: sql`${usage.used} + ${row.used}`, updatedAt: new Date() } });
    }
    await tx.update(reservations).set({ learnerId: canonicalLearnerId })
      .where(eq(reservations.learnerId, anonymous.learnerId));
    await tx.update(attempts).set({ learnerId: canonicalLearnerId })
      .where(eq(attempts.learnerId, anonymous.learnerId));
    await tx.delete(usage).where(eq(usage.learnerId, anonymous.learnerId));
    await tx.insert(aliases).values({ learnerId: anonymous.learnerId, canonicalLearnerId });
    // Keep checkout records, including retired ones; the tombstone above is
    // checked before checkout routing. Known retained events keep working.
    await tx.update(checkouts).set({ learnerId: canonicalLearnerId }).where(eq(checkouts.learnerId, anonymous.learnerId));
    const [resolved] = await tx.update(cases).set({ status: "resolved", retainedMembershipId, resolvedAt: new Date() })
      .where(eq(cases.conflictId, conflictId)).returning();
    return resolved;
  });
}