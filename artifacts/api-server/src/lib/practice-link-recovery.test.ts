import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test, mock } from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, practiceLearnersTable as learners, practiceLinkConflictsTable as cases,
  practiceLinkAuditTable as audits, practiceCoachingUsageTable as usage,
  practiceRetiredMembershipsTable as retired, practiceLearnerAliasesTable as aliases,
  practiceWhopWebhookEventsTable as events, practiceCheckoutSessionsTable as checkouts,
  practiceCoachingReservationsTable as reservations,
  practiceAttemptsTable as attempts,
} from "@workspace/db";
import { ensureAuthenticatedPracticeLearner, PracticeLearnerLinkConflictError, releasePracticeCoachingRequest, getPracticeUsage, ensurePracticeLearner, reservePracticeCoachingRequest } from "./practice-usage";
import { recordPracticeConflictEvidence, resolvePracticeConflict, type RecoveryEvidence } from "./practice-link-recovery";
import { applyWhopWebhookEvent } from "./practice-billing";
import { recoveryMembershipReader } from "./practice-recovery-whop";

after(async () => { await pool.end(); });

for (const retainAnonymous of [false, true]) {
  test(`durable cross-device conflict, verified atomic resolution retaining ${retainAnonymous ? "browser" : "account"}`, async () => {
    const id = randomUUID();
    const accountId = `${id}-account`, browserId = `${id}-browser`, authUserId = `${id}-auth`;
    const accountMembership = `${id}-m1`, browserMembership = `${id}-m2`;
    const eventIds = [`${id}-old`, `${id}-retained`];
    const planId = `plan_${id}`;
    const previousPlan = process.env.WHOP_PLAN_ID;
    const previousCompany = process.env.WHOP_COMPANY_ID;
    process.env.WHOP_COMPANY_ID = "biz_recovery_test";
    process.env.WHOP_PLAN_ID = planId;
    let conflictId: string | undefined;
    try {
      await db.insert(learners).values([
        { learnerId: accountId, authUserId, whopMembershipId: accountMembership, whopPlanId: planId, plan: "pro" },
        { learnerId: browserId, whopMembershipId: browserMembership, whopPlanId: planId, plan: "pro" },
      ]);
      await db.insert(attempts).values({
        attemptId: `${id}-attempt`,
        learnerId: browserId,
        questionId: `${id}-question`,
        prompt: "Which evidence should be checked?",
        skill: "Critical thinking",
        difficulty: "Core",
        answer: "Verify the source",
        correctAnswer: "Verify the source",
        correct: true,
        feedback: "Check the authoritative source.",
        pointsEarned: 25,
      });
      await db.insert(checkouts).values({ checkoutConfigurationId: `${id}-checkout`, learnerId: browserId, planId });
      for (const periodKey of ["2026-01", "2026-02"]) {
        await db.insert(usage).values([
          { learnerId: accountId, periodKey, used: 4 }, { learnerId: browserId, periodKey, used: 7 },
        ]);
      }
      await db.insert(reservations).values({
        reservationId: `${id}-reservation`, learnerId: browserId, periodKey: "2026-01",
        expiresAt: new Date(Date.now() + 600_000),
      });
      await assert.rejects(ensureAuthenticatedPracticeLearner(authUserId, browserId), error => {
        assert.ok(error instanceof PracticeLearnerLinkConflictError);
        conflictId = error.conflictId;
        assert.equal(error.status, "pending_review");
        return true;
      });
      assert.ok(conflictId);
      const [persisted] = await db.select().from(cases).where(eq(cases.conflictId, conflictId));
      assert.equal(persisted.status, "pending");
      await assert.rejects(ensureAuthenticatedPracticeLearner(authUserId), error => {
        assert.ok(error instanceof PracticeLearnerLinkConflictError);
        assert.equal(error.conflictId, conflictId);
        return true;
      });
      const retainedMembershipId = retainAnonymous ? browserMembership : accountMembership;
      const endedMembershipId = retainAnonymous ? accountMembership : browserMembership;
      const evidence: RecoveryEvidence = {
        ticket: `ticket-${id}`, authUserId, canonicalLearnerId: accountId, retainedMembershipId,
        ownership: [accountMembership, browserMembership].map(membershipId => ({
          membershipId, whopUserId: "user_verified", verifiedOwnerAuthUserId: authUserId, evidenceReference: `restricted-ticket/${id}/${membershipId}`,
          method: "provider_dashboard_and_authenticated_customer", verifiedAt: new Date().toISOString(),
        })),
        ended: { membershipId: endedMembershipId, status: "canceled", recurringBillingDisabled: true,
          accessEnded: true, endedAt: new Date().toISOString(), verifiedAt: new Date().toISOString(), providerRecordReference: `provider-record/${id}` },
      };
      await assert.rejects(resolvePracticeConflict(conflictId, "test-operator", accountId, retainedMembershipId), /evidence/i);
      await assert.rejects(recordPracticeConflictEvidence(conflictId, "test-operator", { ...evidence, ownership: evidence.ownership.slice(0, 1) }), /BOTH/i);
      await assert.rejects(recordPracticeConflictEvidence(conflictId, "test-operator", {
        ...evidence, ended: { ...evidence.ended, accessEnded: false as unknown as true },
      }), /ended/i);
      let providerStatus = "canceled";
      let providerUnavailable = false;
      let barrier: Promise<void> | undefined;
      let notifyRead: (() => void) | undefined;
      const reads: string[] = [];
      mock.method(recoveryMembershipReader, "retrieve", async (membershipId: string) => {
        reads.push(membershipId);
        notifyRead?.();
        await barrier;
        if (providerUnavailable) throw new Error("private provider error");
        return {
          id: membershipId, account: { id: "biz_recovery_test" }, plan_id: planId,
          user_id: "user_verified", status: membershipId === endedMembershipId ? providerStatus : "active",
          cancel_at_period_end: false, current_period_end: null,
        };
      });
      providerUnavailable = true;
      await assert.rejects(recordPracticeConflictEvidence(conflictId, "test-operator", evidence), /unavailable/);
      assert.equal((await db.select().from(cases).where(eq(cases.conflictId, conflictId)))[0].evidence, null);
      providerUnavailable = false;
      async function duringProviderRead(operation: () => Promise<unknown>, work: () => Promise<void>) {
        let release!: () => void;
        const started = new Promise<void>(resolve => { notifyRead = resolve; });
        barrier = new Promise<void>(resolve => { release = resolve; });
        const pending = operation().then(value => ({ value, error: undefined }), error => ({ error }));
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            (async () => { await started; await work(); })(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("Learner work blocked by provider read")), 3000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
          notifyRead = undefined;
          barrier = undefined;
          release();
        }
        const result = await pending;
        if (result.error) throw result.error;
      }
      const record = () => recordPracticeConflictEvidence(conflictId!, "test-operator", evidence);
      const resolve = () => resolvePracticeConflict(conflictId!, "test-operator", accountId, retainedMembershipId);
      async function learnerRequest() {
        const learner = await ensurePracticeLearner(accountId);
        await getPracticeUsage(learner);
        const reservation = await reservePracticeCoachingRequest(learner, new Date("2026-01-15T00:00:00Z"));
        assert.ok(reservation);
        await releasePracticeCoachingRequest(reservation.reservationId);
      }
      // Both operations must release the global lock before waiting on Whop.
      await duringProviderRead(record, async () => {
        await learnerRequest();
        await assert.rejects(ensureAuthenticatedPracticeLearner(authUserId), PracticeLearnerLinkConflictError);
      });
      for (const operation of [record, resolve]) {
        await assert.rejects(duringProviderRead(operation, async () => {
          // Identical evidence rewritten by another operator invalidates the snapshot.
          await db.update(cases).set({ evidence }).where(eq(cases.conflictId, conflictId!));
          await learnerRequest();
        }), /changed/);
        await assert.rejects(duringProviderRead(operation, async () => {
          await db.update(learners).set({ whopStatus: "changed" }).where(eq(learners.learnerId, browserId));
          await db.update(learners).set({ whopStatus: null }).where(eq(learners.learnerId, browserId));
        }), /changed/);
        let clock = 100;
        const clockMock = mock.method(performance, "now", () => clock);
        try {
          await assert.rejects(duringProviderRead(operation, async () => { clock += 30_001; }), /stale/);
        } finally {
          clockMock.mock.restore();
        }
        assert.equal((await db.select().from(cases).where(eq(cases.conflictId, conflictId)))[0].status, "pending");
        assert.equal((await db.select().from(retired).where(eq(retired.conflictId, conflictId))).length, 0);
        assert.equal((await db.select().from(audits).where(eq(audits.conflictId, conflictId))).filter(a => a.action === "approved_and_resolved").length, 0);
      }
      await recordPracticeConflictEvidence(conflictId, "test-operator", evidence);
      providerStatus = "active";
      await assert.rejects(resolvePracticeConflict(conflictId, "test-operator", accountId, retainedMembershipId), /termination/);
      assert.equal((await db.select().from(cases).where(eq(cases.conflictId, conflictId)))[0].status, "pending");
      assert.equal((await db.select().from(retired).where(eq(retired.conflictId, conflictId))).length, 0);
      providerStatus = "canceled";
      await assert.rejects(resolvePracticeConflict(conflictId, "test-operator", browserId, retainedMembershipId), /canonical/i);
      // Force a late SQL failure after audit/retirement/usage writes. All must roll back.
      await db.insert(aliases).values({ learnerId: browserId, canonicalLearnerId: accountId });
      await assert.rejects(resolve());
      await db.delete(aliases).where(eq(aliases.learnerId, browserId));
      assert.equal((await db.select().from(retired).where(eq(retired.conflictId, conflictId))).length, 0);
      assert.equal((await db.select().from(audits).where(eq(audits.conflictId, conflictId))).filter(a => a.action === "approved_and_resolved").length, 0);
      assert.deepEqual((await db.select().from(usage).where(eq(usage.learnerId, browserId))).map(r => r.used), [7, 7]);
      await duringProviderRead(() => Promise.all([resolve(), resolve()]), async () => {
        await learnerRequest();
        await assert.rejects(ensureAuthenticatedPracticeLearner(authUserId), PracticeLearnerLinkConflictError);
      });
      const rows = await db.select().from(usage).where(eq(usage.learnerId, accountId));
      assert.deepEqual(rows.map(r => r.used), [11, 11]);
      const retainedAttempts = await db.select().from(attempts)
        .where(eq(attempts.learnerId, accountId));
      assert.equal(retainedAttempts.length, 1);
      assert.equal(retainedAttempts[0].attemptId, `${id}-attempt`);
      assert.equal((await db.select().from(usage).where(eq(usage.learnerId, browserId))).length, 0);
      assert.equal((await ensureAuthenticatedPracticeLearner(authUserId, browserId)).learnerId, accountId);
      await releasePracticeCoachingRequest(`${id}-reservation`);
      await releasePracticeCoachingRequest(`${id}-reservation`);
      assert.equal((await db.select().from(usage).where(eq(usage.learnerId, accountId))).find(r => r.periodKey === "2026-01")?.used, 10);
      assert.equal(await applyWhopWebhookEvent({
        id: eventIds[0], type: "membership.activated",
        data: { id: endedMembershipId, plan_id: planId, checkout_configuration_id: `${id}-checkout` },
      }, new Date()), "ignored");
      assert.equal(await applyWhopWebhookEvent({
        id: eventIds[1], type: "membership.activated",
        data: { id: retainedMembershipId, plan_id: planId },
      }, new Date()), "processed");
      assert.equal((await db.select().from(learners).where(eq(learners.learnerId, accountId)))[0].whopMembershipId, retainedMembershipId);
      const history = await db.select().from(audits).where(eq(audits.conflictId, conflictId));
      assert.equal(history.filter(a => a.action === "approved_and_resolved").length, 1);
      assert.equal((history.find(a => a.action === "approved_and_resolved")!.details as { providerChecks: unknown[] }).providerChecks.length, 2);
      assert.ok(reads.filter(id => id === endedMembershipId).length >= 3);
    } finally {
      mock.restoreAll();
      if (previousCompany === undefined) delete process.env.WHOP_COMPANY_ID; else process.env.WHOP_COMPANY_ID = previousCompany;
      if (previousPlan === undefined) delete process.env.WHOP_PLAN_ID; else process.env.WHOP_PLAN_ID = previousPlan;
      await db.delete(events).where(inArray(events.eventId, eventIds));
      await db.delete(aliases).where(eq(aliases.learnerId, browserId));
      if (conflictId) {
        await db.delete(retired).where(eq(retired.conflictId, conflictId));
        await db.delete(audits).where(eq(audits.conflictId, conflictId));
        await db.delete(cases).where(eq(cases.conflictId, conflictId));
      }
      await db.delete(learners).where(inArray(learners.learnerId, [accountId, browserId]));
    }
  });
}