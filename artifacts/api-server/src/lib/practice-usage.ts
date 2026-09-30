import { randomUUID } from "node:crypto";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import {
  db,
  practiceCheckoutSessionsTable,
  practiceCoachingUsageTable,
  practiceCoachingReservationsTable,
  practiceLearnersTable,
  practiceLinkConflictsTable,
  practiceLearnerAliasesTable,
  practiceAttemptsTable,
} from "@workspace/db";
import { lockPracticeLinks } from "./practice-link-lock";
import { COACHING_RESERVATION_LEASE_MS, reconcilePracticeCoachingReservations } from "./practice-reservations";
export { releasePracticeCoachingRequest } from "./practice-reservations";

export const FREE_COACHING_MONTHLY_LIMIT = 20;
export const PRO_COACHING_MONTHLY_LIMIT = 500;

type PracticeLearner = typeof practiceLearnersTable.$inferSelect;
type SubscriptionStatus =
  | "active"
  | "canceling"
  | "past_due"
  | "canceled"
  | "expired";

const subscriptionStatuses = new Set<SubscriptionStatus>([
  "active",
  "canceling",
  "past_due",
  "canceled",
  "expired",
]);

export class PracticeLearnerLinkConflictError extends Error {
  readonly status = "pending_review";
  constructor(public readonly conflictId: string, _status?: string) {
    super(
      "This browser has a separate Pro subscription that cannot be merged automatically. Contact your academy administrator to link the accounts.",
    );
    this.name = "PracticeLearnerLinkConflictError";
  }
}

type UsagePeriod = {
  key: string;
  resetsAt: string;
};

export function getPracticeUsagePeriod(now = new Date()): UsagePeriod {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    key: `${year}-${String(month + 1).padStart(2, "0")}`,
    resetsAt: new Date(Date.UTC(year, month + 1, 1)).toISOString(),
  };
}

function getUpgradeUrl(): string | null {
  const configuredUrl = process.env.PRACTICE_PRO_UPGRADE_URL?.trim();
  if (!configuredUrl) return null;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(configuredUrl);
  } catch {
    throw new Error("PRACTICE_PRO_UPGRADE_URL must be a valid HTTPS URL.");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("PRACTICE_PRO_UPGRADE_URL must be a valid HTTPS URL.");
  }

  return parsedUrl.toString();
}

export async function ensurePracticeLearner(learnerId: string) {
  await db
    .insert(practiceLearnersTable)
    .values({ learnerId })
    .onConflictDoNothing();

  let [learner] = await db
    .select()
    .from(practiceLearnersTable)
    .where(eq(practiceLearnersTable.learnerId, learnerId));

  if (!learner) {
    throw new Error("Unable to load the practice learner's plan.");
  }

  const now = new Date();
  if (
    learner.plan === "pro" &&
    learner.whopCurrentPeriodEnd &&
    learner.whopCurrentPeriodEnd <= now
  ) {
    const [expiredLearner] = await db
      .update(practiceLearnersTable)
      .set({ plan: "free", whopStatus: "expired" })
      .where(
        and(
          eq(practiceLearnersTable.learnerId, learnerId),
          eq(practiceLearnersTable.plan, "pro"),
          lte(practiceLearnersTable.whopCurrentPeriodEnd, now),
        ),
      )
      .returning();
    if (expiredLearner) learner = expiredLearner;
  }

  return learner;
}

async function mergeAnonymousLearner(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  accountLearner: PracticeLearner,
  anonymousLearner: PracticeLearner,
): Promise<void> {
  if (
    accountLearner.whopMembershipId &&
    anonymousLearner.whopMembershipId &&
    accountLearner.whopMembershipId !== anonymousLearner.whopMembershipId
  ) {
    throw new Error("Membership conflicts must be recorded before merging.");
  }

  const transferWhopMembership =
    !accountLearner.whopMembershipId &&
    Boolean(anonymousLearner.whopMembershipId);
  const transferServerPlan =
    accountLearner.plan === "free" && anonymousLearner.plan === "pro";

  if (transferWhopMembership || transferServerPlan) {
    if (transferWhopMembership) {
      // Release the unique membership ID before assigning it to the account row.
      await tx
        .update(practiceLearnersTable)
        .set({ whopMembershipId: null })
        .where(eq(practiceLearnersTable.learnerId, anonymousLearner.learnerId));
    }
    await tx
      .update(practiceLearnersTable)
      .set({
        plan:
          accountLearner.plan === "pro"
            ? "pro"
            : anonymousLearner.plan,
        ...(transferWhopMembership
          ? {
              whopMembershipId: anonymousLearner.whopMembershipId,
              whopCheckoutConfigurationId:
                anonymousLearner.whopCheckoutConfigurationId,
              whopPlanId: anonymousLearner.whopPlanId,
              whopStatus: anonymousLearner.whopStatus,
              whopCurrentPeriodEnd:
                anonymousLearner.whopCurrentPeriodEnd,
              whopManageUrl: anonymousLearner.whopManageUrl,
              whopRecoveryUrl: anonymousLearner.whopRecoveryUrl,
              whopLastEventAt: anonymousLearner.whopLastEventAt,
            }
          : {}),
      })
      .where(eq(practiceLearnersTable.learnerId, accountLearner.learnerId));
  }

  const anonymousUsage = await tx
    .select()
    .from(practiceCoachingUsageTable)
    .where(eq(practiceCoachingUsageTable.learnerId, anonymousLearner.learnerId))
    .for("update");

  for (const usage of anonymousUsage) {
    await tx
      .insert(practiceCoachingUsageTable)
      .values({
        learnerId: accountLearner.learnerId,
        periodKey: usage.periodKey,
        used: usage.used,
      })
      .onConflictDoUpdate({
        target: [
          practiceCoachingUsageTable.learnerId,
          practiceCoachingUsageTable.periodKey,
        ],
        set: {
          used: sql`${practiceCoachingUsageTable.used} + ${usage.used}`,
          updatedAt: new Date(),
        },
      });
  }

  await tx
    .update(practiceCheckoutSessionsTable)
    .set({ learnerId: accountLearner.learnerId })
    .where(
      eq(practiceCheckoutSessionsTable.learnerId, anonymousLearner.learnerId),
    );

  await tx.update(practiceCoachingReservationsTable)
    .set({ learnerId: accountLearner.learnerId })
    .where(eq(practiceCoachingReservationsTable.learnerId, anonymousLearner.learnerId));
  await tx.update(practiceAttemptsTable)
    .set({ learnerId: accountLearner.learnerId })
    .where(eq(practiceAttemptsTable.learnerId, anonymousLearner.learnerId));
  await tx
    .delete(practiceLearnersTable)
    .where(eq(practiceLearnersTable.learnerId, anonymousLearner.learnerId));
}

/**
 * Resolves the internal coaching record from Clerk's verified user ID.
 * A valid legacy cookie may be claimed once or merged into an existing account;
 * browser-provided IDs never determine plan or account ownership.
 */
export async function ensureAuthenticatedPracticeLearner(
  authUserId: string,
  anonymousLearnerId?: string,
): Promise<PracticeLearner> {
  const learnerId = await db.transaction(async (tx) => {
    await lockPracticeLinks(tx);
    // Serialize account linking for the same authenticated user across devices.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${authUserId}))`,
    );

    const [pending] = await tx.select().from(practiceLinkConflictsTable).where(
      and(eq(practiceLinkConflictsTable.authUserId, authUserId), eq(practiceLinkConflictsTable.status, "pending")),
    );
    if (pending) return { conflictId: pending.conflictId, status: pending.status };

    let [accountLearner] = await tx
      .select()
      .from(practiceLearnersTable)
      .where(eq(practiceLearnersTable.authUserId, authUserId))
      .for("update");

    let [cookieLearner]: (PracticeLearner | undefined)[] = anonymousLearnerId
      ? await tx
          .select()
          .from(practiceLearnersTable)
          .where(eq(practiceLearnersTable.learnerId, anonymousLearnerId))
          .for("update")
      : [];

    if (cookieLearner) {
      const [alias] = await tx.select().from(practiceLearnerAliasesTable)
        .where(eq(practiceLearnerAliasesTable.learnerId, cookieLearner.learnerId));
      if (alias) cookieLearner = undefined;
    }
    if (cookieLearner) {
      const [claim] = await tx.select().from(practiceLinkConflictsTable).where(and(
        eq(practiceLinkConflictsTable.anonymousLearnerId, cookieLearner.learnerId),
        eq(practiceLinkConflictsTable.status, "pending"),
      ));
      // A different authenticated account must not consume a disputed browser
      // learner or learn another account's support case ID.
      if (claim && claim.authUserId !== authUserId) cookieLearner = undefined;
    }

    if (!accountLearner && cookieLearner && cookieLearner.authUserId === null) {
      [accountLearner] = await tx
        .update(practiceLearnersTable)
        .set({ authUserId })
        .where(
          and(
            eq(practiceLearnersTable.learnerId, cookieLearner.learnerId),
            isNull(practiceLearnersTable.authUserId),
          ),
        )
        .returning();
    }

    if (!accountLearner) {
      const [createdLearner] = await tx
        .insert(practiceLearnersTable)
        .values({ learnerId: randomUUID(), authUserId })
        .onConflictDoNothing()
        .returning();

      accountLearner =
        createdLearner ??
        (
          await tx
            .select()
            .from(practiceLearnersTable)
            .where(eq(practiceLearnersTable.authUserId, authUserId))
            .for("update")
        )[0];
    }

    if (!accountLearner) {
      throw new Error("Unable to resolve the authenticated practice learner.");
    }

    if (
      cookieLearner &&
      cookieLearner.learnerId !== accountLearner.learnerId &&
      cookieLearner.authUserId === null
    ) {
      const [alias] = await tx.select().from(practiceLearnerAliasesTable)
        .where(eq(practiceLearnerAliasesTable.learnerId, cookieLearner.learnerId));
      if (alias) return accountLearner.learnerId;
      if (accountLearner.whopMembershipId && cookieLearner.whopMembershipId &&
          accountLearner.whopMembershipId !== cookieLearner.whopMembershipId) {
        const [conflict] = await tx.insert(practiceLinkConflictsTable).values({
          conflictId: randomUUID(), authUserId,
          canonicalLearnerId: accountLearner.learnerId,
          anonymousLearnerId: cookieLearner.learnerId,
          accountMembershipId: accountLearner.whopMembershipId,
          anonymousMembershipId: cookieLearner.whopMembershipId,
        }).onConflictDoUpdate({
          target: [practiceLinkConflictsTable.canonicalLearnerId, practiceLinkConflictsTable.anonymousLearnerId],
          set: { status: "pending" },
        }).returning();
        return { conflictId: conflict.conflictId, status: conflict.status };
      }
      await mergeAnonymousLearner(tx, accountLearner, cookieLearner);
    }

    return accountLearner.learnerId;
  });

  // Throw only AFTER the transaction commits, or the support case is lost.
  if (typeof learnerId !== "string") {
    throw new PracticeLearnerLinkConflictError(learnerId.conflictId, learnerId.status);
  }
  return ensurePracticeLearner(learnerId);
}

function formatUsage(
  learner: PracticeLearner,
  used: number,
  period: UsagePeriod,
) {
  const monthlyLimit =
    learner.plan === "pro"
      ? PRO_COACHING_MONTHLY_LIMIT
      : FREE_COACHING_MONTHLY_LIMIT;
  const configuredCompanyId = process.env.WHOP_COMPANY_ID?.trim();
  const configuredPlanId = process.env.WHOP_PLAN_ID?.trim();
  const configuredWebhookSecret = process.env.WHOP_WEBHOOK_SECRET?.trim();
  const subscriptionStatus = subscriptionStatuses.has(
    learner.whopStatus as SubscriptionStatus,
  )
    ? (learner.whopStatus as SubscriptionStatus)
    : null;

  return {
    learnerId: learner.learnerId,
    plan: learner.plan,
    used,
    monthlyLimit,
    remaining: Math.max(0, monthlyLimit - used),
    resetsAt: period.resetsAt,
    upgradeUrl: learner.plan === "free" ? getUpgradeUrl() : null,
    checkoutAvailable: Boolean(
      configuredCompanyId && configuredPlanId && configuredWebhookSecret,
    ),
    subscriptionStatus,
    subscriptionPeriodEndsAt:
      learner.whopCurrentPeriodEnd?.toISOString() ?? null,
    subscriptionManagementUrl: learner.whopManageUrl,
    paymentRecoveryUrl: learner.whopRecoveryUrl,
  };
}

export async function getPracticeUsage(
  learner: PracticeLearner,
  now = new Date(),
) {
  await reconcilePracticeCoachingReservations();
  const period = getPracticeUsagePeriod(now);
  const [usage] = await db
    .select({ used: practiceCoachingUsageTable.used })
    .from(practiceCoachingUsageTable)
    .where(
      and(
        eq(practiceCoachingUsageTable.learnerId, learner.learnerId),
        eq(practiceCoachingUsageTable.periodKey, period.key),
      ),
    );

  return formatUsage(learner, usage?.used ?? 0, period);
}

export async function reservePracticeCoachingRequest(
  learner: PracticeLearner,
  now = new Date(),
) {
  await reconcilePracticeCoachingReservations();
  return db.transaction(async (tx) => {
  await lockPracticeLinks(tx);
  const [alias] = await tx.select().from(practiceLearnerAliasesTable)
    .where(eq(practiceLearnerAliasesTable.learnerId, learner.learnerId));
  if (alias) {
    const [canonical] = await tx.select().from(practiceLearnersTable)
      .where(eq(practiceLearnersTable.learnerId, alias.canonicalLearnerId));
    if (!canonical) throw new Error("Missing canonical learner.");
    learner = canonical;
  }
  const period = getPracticeUsagePeriod(now);
  const monthlyLimit =
    learner.plan === "pro"
      ? PRO_COACHING_MONTHLY_LIMIT
      : FREE_COACHING_MONTHLY_LIMIT;

  const [reservation] = await tx
    .insert(practiceCoachingUsageTable)
    .values({ learnerId: learner.learnerId, periodKey: period.key, used: 1 })
    .onConflictDoUpdate({
      target: [
        practiceCoachingUsageTable.learnerId,
        practiceCoachingUsageTable.periodKey,
      ],
      set: {
        used: sql`${practiceCoachingUsageTable.used} + 1`,
        updatedAt: new Date(),
      },
      where: sql`${practiceCoachingUsageTable.used} < ${monthlyLimit}`,
    })
    .returning({ used: practiceCoachingUsageTable.used });

  if (!reservation) return null;

  const reservationId = randomUUID();
  await tx.insert(practiceCoachingReservationsTable).values({
    reservationId,
    learnerId: learner.learnerId,
    periodKey: period.key,
    expiresAt: sql`clock_timestamp() + ${COACHING_RESERVATION_LEASE_MS} * interval '1 millisecond'`,
  });
  return {
    reservationId,
    periodKey: period.key,
    usage: formatUsage(learner, reservation.used, period),
  };
  });
}
