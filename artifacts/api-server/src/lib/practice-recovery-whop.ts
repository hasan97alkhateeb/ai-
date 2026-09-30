import { getWhopClient } from "./whop-client";

// Kept separate from recovery transactions so tests can replace the network only.
export const recoveryMembershipReader = {
  async retrieve(id: string) {
    const client = await getWhopClient();
    return client.memberships.retrieve({ id }, { timeoutInSeconds: 12, maxRetries: 0 });
  },
};

export type MembershipExpectation = {
  membershipId: string;
  whopUserId: string;
};

export async function corroborateRecoveryMemberships(
  ownership: MembershipExpectation[],
  ended: { membershipId: string; status: "canceled" | "expired" },
) {
  const companyId = process.env.WHOP_COMPANY_ID?.trim();
  const planId = process.env.WHOP_PLAN_ID?.trim();
  if (!companyId?.startsWith("biz_") || !planId?.startsWith("plan_")) {
    throw new Error("Live Whop recovery checks require configured company and plan IDs.");
  }
  return Promise.all(ownership.map(async proof => {
    if (!proof.whopUserId?.startsWith("user_")) {
      throw new Error("Record the independently verified Whop buyer ID for BOTH memberships.");
    }
    let membership;
    try {
      membership = await recoveryMembershipReader.retrieve(proof.membershipId);
    } catch {
      // Never expose SDK errors, credentials, or provider response bodies.
      throw new Error("Live Whop membership verification unavailable. Stop and retry; no manual bypass.");
    }
    if (!membership || membership.id !== proof.membershipId ||
        membership.account?.id !== companyId || membership.plan_id !== planId ||
        membership.user_id !== proof.whopUserId) {
      throw new Error("Live Whop membership identity mismatch. Re-verify ownership and escalate.");
    }
    if (membership.id === ended.membershipId) {
      // Terminal billing states revoke access. A scheduled cancellation alone
      // (including active + cancel_at_period_end) is never terminal.
      if (membership.status !== ended.status ||
          !["canceled", "expired"].includes(membership.status)) {
        throw new Error("Live Whop duplicate termination is not complete or contradicts evidence.");
      }
      if (membership.status === "expired" &&
          (!membership.current_period_end ||
           !Number.isFinite(Date.parse(membership.current_period_end)) ||
           Date.parse(membership.current_period_end) > Date.now())) {
        throw new Error("Live Whop duplicate expiry has not been confirmed.");
      }
    } else if (!["active", "trialing", "completed"].includes(membership.status)) {
      throw new Error("Live Whop retained membership is not active; escalate before approval.");
    }
    return {
      membershipId: membership.id, whopUserId: membership.user_id,
      companyId, planId, status: membership.status,
      cancelAtPeriodEnd: membership.cancel_at_period_end,
      currentPeriodEnd: membership.current_period_end,
      checkedAt: new Date().toISOString(),
    };
  }));
}