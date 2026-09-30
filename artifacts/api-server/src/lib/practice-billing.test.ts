import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, practiceLearnersTable as learners,
  practiceCheckoutSessionsTable as checkouts,
  practiceWhopWebhookEventsTable as events,
  practiceRetiredMembershipsTable as retired,
} from "@workspace/db";
import { applyWhopWebhookEvent } from "./practice-billing";

after(async () => { await pool.end(); });

for (const status of ["canceled", "expired"] as const) {
  test(`${status} membership permits fresh repurchase, but not stale checkout or retired replay`, async () => {
    const id = randomUUID();
    const learnerId = `${id}-learner`, oldMembership = `${id}-old`, newMembership = `${id}-new`;
    const oldCheckout = `${id}-checkout-old`, freshCheckout = `${id}-checkout-fresh`;
    const stalePendingCheckout = `${id}-checkout-stale`;
    const retiredMembership = `${id}-retired`, retiredCheckout = `${id}-checkout-retired`;
    const planId = `plan_${id}`, eventIds: string[] = [];
    const previousPlan = process.env.WHOP_PLAN_ID;
    process.env.WHOP_PLAN_ID = planId;
    const base = Date.now() - 600_000;
    const time = (offset: number) => new Date(base + offset * 1000);
    async function activation(membershipId: string, checkout: string | undefined, offset = 300) {
      const eventId = `${id}-event-${eventIds.length}`;
      eventIds.push(eventId);
      return applyWhopWebhookEvent({
        id: eventId, type: "membership.activated", timestamp: time(offset).toISOString(),
        data: { id: membershipId, plan_id: planId, checkout_configuration_id: checkout },
      }, new Date());
    }
    try {
      await db.insert(learners).values({
        learnerId, plan: "free", whopMembershipId: oldMembership,
        whopCheckoutConfigurationId: oldCheckout, whopPlanId: planId,
        whopStatus: status, whopCurrentPeriodEnd: time(100), whopLastEventAt: time(100),
      });
      await db.insert(checkouts).values([
        { checkoutConfigurationId: oldCheckout, learnerId, planId, status: "active", createdAt: time(0) },
        { checkoutConfigurationId: stalePendingCheckout, learnerId, planId, status: "pending", createdAt: time(50) },
        { checkoutConfigurationId: freshCheckout, learnerId, planId, status: "pending", createdAt: time(200) },
        { checkoutConfigurationId: retiredCheckout, learnerId, planId, status: "pending", createdAt: time(450) },
      ]);
      assert.equal(await activation(newMembership, undefined), "ignored");
      assert.equal(await activation(newMembership, oldCheckout), "ignored");
      assert.equal(await activation(newMembership, stalePendingCheckout), "ignored");
      // Even a fresh checkout cannot displace an active subscription.
      await db.update(learners).set({ plan: "pro", whopStatus: "active" }).where(eq(learners.learnerId, learnerId));
      assert.equal(await activation(newMembership, freshCheckout), "ignored");
      await db.update(learners).set({ plan: "free", whopStatus: status }).where(eq(learners.learnerId, learnerId));
      assert.equal(await activation(newMembership, freshCheckout), "processed");
      const [activated] = await db.select().from(learners).where(eq(learners.learnerId, learnerId));
      assert.equal(activated.plan, "pro");
      assert.equal(activated.whopMembershipId, newMembership);
      assert.equal((await db.select().from(checkouts).where(eq(checkouts.checkoutConfigurationId, freshCheckout)))[0].status, "active");
      // Subsequent expiry must not make previously used sessions valid again.
      await db.update(learners).set({
        plan: "free", whopStatus: "expired", whopCurrentPeriodEnd: time(400), whopLastEventAt: time(400),
      }).where(eq(learners.learnerId, learnerId));
      assert.equal(await activation(oldMembership, oldCheckout, 500), "ignored");
      assert.equal(await activation(oldMembership, freshCheckout, 500), "ignored");
      assert.equal(await activation(oldMembership, stalePendingCheckout, 500), "ignored");
      await db.insert(retired).values({ membershipId: retiredMembership, conflictId: `${id}-case`, canonicalLearnerId: learnerId });
      assert.equal(await activation(retiredMembership, retiredCheckout, 500), "ignored");
      assert.equal((await db.select().from(learners).where(eq(learners.learnerId, learnerId)))[0].whopMembershipId, newMembership);
    } finally {
      if (previousPlan === undefined) delete process.env.WHOP_PLAN_ID; else process.env.WHOP_PLAN_ID = previousPlan;
      if (eventIds.length) await db.delete(events).where(inArray(events.eventId, eventIds));
      await db.delete(retired).where(eq(retired.membershipId, retiredMembership));
      await db.delete(learners).where(eq(learners.learnerId, learnerId));
    }
  });
}