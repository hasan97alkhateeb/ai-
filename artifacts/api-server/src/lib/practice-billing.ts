import { and, eq } from "drizzle-orm";
import {
  db,
  practiceCheckoutSessionsTable,
  practiceLearnersTable,
  practiceWhopWebhookEventsTable,
  practiceRetiredMembershipsTable,
  practiceLearnerAliasesTable,
} from "@workspace/db";
import { lockPracticeLinks } from "./practice-link-lock";
import { getWhopClient } from "./whop-client";

export type WhopWebhookEvent = {
  id: string;
  type: string;
  timestamp?: string | number;
  data: Record<string, unknown>;
};

export function hasWhopCheckoutConfiguration(): boolean {
  return Boolean(
    process.env.WHOP_COMPANY_ID?.trim() &&
      process.env.WHOP_PLAN_ID?.trim() &&
      process.env.WHOP_WEBHOOK_SECRET?.trim(),
  );
}

function getWhopCheckoutConfiguration() {
  const companyId = process.env.WHOP_COMPANY_ID?.trim();
  const planId = process.env.WHOP_PLAN_ID?.trim();
  if (
    !companyId ||
    !planId ||
    !process.env.WHOP_WEBHOOK_SECRET?.trim()
  ) {
    throw new Error("Whop checkout and webhook signing are not configured.");
  }
  if (!companyId.startsWith("biz_") || !planId.startsWith("plan_")) {
    throw new Error("Whop checkout configuration contains an invalid ID.");
  }
  return { companyId, planId };
}

export async function createPracticeProCheckout(
  learnerId: string,
  redirectUrl: string,
): Promise<string> {
  const { companyId, planId } = getWhopCheckoutConfiguration();
  const client = await getWhopClient();
  const plan = await client.plans.retrieve(
    { id: planId },
    { timeoutInSeconds: 12, maxRetries: 1 },
  );
  if (
    plan.initial_price !== 15 ||
    plan.renewal_price !== 15 ||
    plan.billing_period !== 30 ||
    plan.currency.toLowerCase() !== "usd" ||
    plan.plan_type !== "renewal"
  ) {
    throw new Error(
      "The configured Whop plan must renew at USD 15 every 30 days.",
    );
  }

  const checkout = await client.checkoutConfigurations.create({
    account_id: companyId,
    plan_id: planId,
    redirect_url: redirectUrl,
  });

  if (!checkout.id || !checkout.purchase_url) {
    throw new Error("Whop did not return a usable checkout URL.");
  }

  await db
    .insert(practiceCheckoutSessionsTable)
    .values({
      checkoutConfigurationId: checkout.id,
      learnerId,
      planId,
    });

  return checkout.purchase_url;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getEventPlanId(data: Record<string, unknown>): string | null {
  const membership = asRecord(data.membership);
  const plan = asRecord(data.plan) ?? asRecord(membership?.plan);
  return (
    stringValue(data.plan_id) ??
    stringValue(plan?.id) ??
    stringValue(membership?.plan_id)
  );
}

function getMembershipId(
  eventType: string,
  data: Record<string, unknown>,
): string | null {
  const membership = asRecord(data.membership);
  const nested = asRecord(data.data);
  const eventIsMembership = eventType.startsWith("membership.");
  return (
    stringValue(data.membership_id) ??
    stringValue(membership?.id) ??
    stringValue(nested?.membership_id) ??
    (eventIsMembership ? stringValue(data.id) : null)
  );
}

function getCheckoutConfigurationId(
  data: Record<string, unknown>,
): string | null {
  const checkoutConfiguration = asRecord(data.checkout_configuration);
  return (
    stringValue(data.checkout_configuration_id) ??
    stringValue(checkoutConfiguration?.id)
  );
}

function getPeriodEnd(data: Record<string, unknown>): Date | null {
  const membership = asRecord(data.membership);
  const value =
    stringValue(data.renewal_period_end) ??
    stringValue(data.current_period_end) ??
    stringValue(membership?.renewal_period_end) ??
    stringValue(membership?.current_period_end);
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getWhopUrl(data: Record<string, unknown>, keys: string[]): string | null {
  const membership = asRecord(data.membership);
  for (const key of keys) {
    const candidate =
      stringValue(data[key]) ?? stringValue(membership?.[key]);
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (
        url.protocol === "https:" &&
        (url.hostname === "whop.com" || url.hostname.endsWith(".whop.com"))
      ) {
        return url.toString();
      }
    } catch {
      // Ignore malformed URLs from otherwise valid provider events.
    }
  }
  return null;
}

function parseEventTime(value: string | number | undefined, fallback: Date): Date {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? fallback : date;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return fallback;
}

const activeEventTypes = new Set([
  "invoice.paid",
  "membership.activated",
  "membership.went_valid",
  "membership_went_valid",
  "payment.succeeded",
]);

const failedEventTypes = new Set([
  "invoice.past_due",
  "payment.failed",
  "payment.requires_action",
]);

const endedEventTypes = new Set([
  "membership.deactivated",
  "membership.went_invalid",
  "membership_went_invalid",
]);

const cancellationEventTypes = new Set([
  "membership.cancel_at_period_end_changed",
  "membership_cancel_at_period_end_changed",
]);

export async function applyWhopWebhookEvent(
  event: WhopWebhookEvent,
  receivedAt: Date,
): Promise<"processed" | "duplicate" | "ignored"> {
  const eventAt = parseEventTime(event.timestamp, receivedAt);
  const eventData = event.data;
  const eventPlanId = getEventPlanId(eventData);
  const membershipId = getMembershipId(event.type, eventData);
  const checkoutConfigurationId = getCheckoutConfigurationId(eventData);
  const periodEnd = getPeriodEnd(eventData);
  const manageUrl = getWhopUrl(eventData, [
    "manage_url",
    "manage_membership_url",
  ]);
  const recoveryUrl = getWhopUrl(eventData, [
    "recovery_url",
    "payment_recovery_url",
  ]);
  const expectedPlanId = process.env.WHOP_PLAN_ID?.trim();

  return db.transaction(async (transaction) => {
    await lockPracticeLinks(transaction);
    const [claimedEvent] = await transaction
      .insert(practiceWhopWebhookEventsTable)
      .values({
        eventId: event.id,
        eventType: event.type,
        eventAt,
      })
      .onConflictDoNothing()
      .returning({ eventId: practiceWhopWebhookEventsTable.eventId });

    if (!claimedEvent) return "duplicate";
    if (membershipId) {
      const [retired] = await transaction.select().from(practiceRetiredMembershipsTable)
        .where(eq(practiceRetiredMembershipsTable.membershipId, membershipId));
      if (retired) return "ignored";
    }
    if (!expectedPlanId || !expectedPlanId.startsWith("plan_")) {
      return "ignored";
    }
    if (eventPlanId && eventPlanId !== expectedPlanId) return "ignored";

    const [checkoutSession] = checkoutConfigurationId
      ? await transaction
          .select()
          .from(practiceCheckoutSessionsTable)
          .where(
            eq(
              practiceCheckoutSessionsTable.checkoutConfigurationId,
              checkoutConfigurationId,
            ),
          )
          .limit(1)
      : [];
    const [linkedByMembership] = membershipId
      ? await transaction
          .select()
          .from(practiceLearnersTable)
          .where(eq(practiceLearnersTable.whopMembershipId, membershipId))
          .limit(1)
      : [];

    if (
      checkoutSession &&
      checkoutSession.planId !== expectedPlanId
    ) {
      return "ignored";
    }
    if (
      checkoutSession &&
      linkedByMembership &&
      checkoutSession.learnerId !== linkedByMembership.learnerId
    ) {
      return "ignored";
    }

    const learnerId =
      linkedByMembership?.learnerId ?? checkoutSession?.learnerId;
    if (!learnerId) return "ignored";
    const [alias] = await transaction.select().from(practiceLearnerAliasesTable)
      .where(eq(practiceLearnerAliasesTable.learnerId, learnerId));
    if (alias) return "ignored";

    const [learner] = await transaction
      .select()
      .from(practiceLearnersTable)
      .where(eq(practiceLearnersTable.learnerId, learnerId))
      .for("update")
      .limit(1);
    if (!learner) return "ignored";
    if (!membershipId) return "ignored";
    if (learner.whopMembershipId && learner.whopMembershipId !== membershipId) {
      // Repurchase is allowed only after terminal cancellation/expiry, using
      // an unused checkout created AFTER the old subscription ended. Consuming
      // that checkout below prevents replay after a later subscription expires.
      const endedAt = learner.whopStatus === "expired"
        ? Math.max(
            learner.whopCurrentPeriodEnd?.getTime() ?? Infinity,
            learner.whopLastEventAt?.getTime() ?? 0,
          )
        : learner.whopLastEventAt?.getTime() ?? Infinity;
      if (
        learner.plan !== "free" ||
        !["canceled", "expired"].includes(learner.whopStatus ?? "") ||
        endedAt > receivedAt.getTime() ||
        !activeEventTypes.has(event.type) ||
        !checkoutSession ||
        checkoutSession.learnerId !== learnerId ||
        checkoutSession.status !== "pending" ||
        checkoutSession.checkoutConfigurationId === learner.whopCheckoutConfigurationId ||
        checkoutSession.createdAt.getTime() <= endedAt ||
        eventAt.getTime() < checkoutSession.createdAt.getTime()
      ) {
        return "ignored";
      }
    }
    if (
      learner.whopLastEventAt &&
      eventAt.getTime() < learner.whopLastEventAt.getTime()
    ) {
      return "ignored";
    }
    if (learner.whopPlanId && learner.whopPlanId !== expectedPlanId) {
      return "ignored";
    }
    if (
      checkoutSession &&
      learner.whopCheckoutConfigurationId &&
      checkoutSession.checkoutConfigurationId !==
        learner.whopCheckoutConfigurationId
    ) {
      const [currentCheckoutSession] = await transaction
        .select({
          createdAt: practiceCheckoutSessionsTable.createdAt,
        })
        .from(practiceCheckoutSessionsTable)
        .where(
          eq(
            practiceCheckoutSessionsTable.checkoutConfigurationId,
            learner.whopCheckoutConfigurationId,
          ),
        )
        .limit(1);
      if (
        currentCheckoutSession &&
        checkoutSession.createdAt.getTime() <
          currentCheckoutSession.createdAt.getTime()
      ) {
        return "ignored";
      }
    }

    if (
      membershipId &&
      learner.whopMembershipId &&
      learner.whopMembershipId !== membershipId
    ) {
      const [existingMembershipOwner] = await transaction
        .select({ learnerId: practiceLearnersTable.learnerId })
        .from(practiceLearnersTable)
        .where(eq(practiceLearnersTable.whopMembershipId, membershipId))
        .limit(1);
      if (
        existingMembershipOwner &&
        existingMembershipOwner.learnerId !== learnerId
      ) {
        return "ignored";
      }
    }

    const now = new Date();
    const end = periodEnd ?? learner.whopCurrentPeriodEnd;
    const isPaidThrough = Boolean(end && end.getTime() > now.getTime());
    const membership = asRecord(eventData.membership);
    const cancelAtPeriodEnd =
      eventData.cancel_at_period_end === true ||
      membership?.cancel_at_period_end === true;
    let nextPlan = learner.plan;
    let nextStatus = learner.whopStatus;
    let nextRecoveryUrl = learner.whopRecoveryUrl;

    if (activeEventTypes.has(event.type)) {
      nextPlan = "pro";
      nextStatus = cancelAtPeriodEnd ? "canceling" : "active";
      nextRecoveryUrl = null;
    } else if (failedEventTypes.has(event.type)) {
      nextPlan = isPaidThrough ? "pro" : "free";
      nextStatus = "past_due";
      nextRecoveryUrl = recoveryUrl ?? learner.whopRecoveryUrl;
    } else if (endedEventTypes.has(event.type)) {
      const dataStatus = stringValue(eventData.status)?.toLowerCase();
      const isCancellationAtPeriodEnd = cancelAtPeriodEnd && isPaidThrough;
      nextPlan = isCancellationAtPeriodEnd ? "pro" : "free";
      nextStatus = isCancellationAtPeriodEnd
        ? "canceling"
        : dataStatus === "expired"
          ? "expired"
          : "canceled";
      if (!isCancellationAtPeriodEnd) nextRecoveryUrl = null;
    } else if (cancellationEventTypes.has(event.type)) {
      nextPlan = "pro";
      const isCancellationAtPeriodEnd = cancelAtPeriodEnd;
      nextStatus = isCancellationAtPeriodEnd ? "canceling" : "active";
      if (!isCancellationAtPeriodEnd) nextRecoveryUrl = null;
    } else {
      return "processed";
    }

    await transaction
      .update(practiceLearnersTable)
      .set({
        plan: nextPlan,
        whopMembershipId: membershipId ?? learner.whopMembershipId,
        whopCheckoutConfigurationId:
          checkoutConfigurationId ?? learner.whopCheckoutConfigurationId,
        whopPlanId: expectedPlanId,
        whopStatus: nextStatus,
        whopCurrentPeriodEnd: periodEnd ?? learner.whopCurrentPeriodEnd,
        whopManageUrl: manageUrl ?? learner.whopManageUrl,
        whopRecoveryUrl: nextRecoveryUrl,
        whopLastEventAt: eventAt,
      })
      .where(eq(practiceLearnersTable.learnerId, learnerId));

    if (checkoutConfigurationId) {
      await transaction
        .update(practiceCheckoutSessionsTable)
        .set({ status: nextStatus ?? "processed" })
        .where(
          and(
            eq(
              practiceCheckoutSessionsTable.checkoutConfigurationId,
              checkoutConfigurationId,
            ),
            eq(practiceCheckoutSessionsTable.learnerId, learnerId),
          ),
        );
    }

    return "processed";
  });
}