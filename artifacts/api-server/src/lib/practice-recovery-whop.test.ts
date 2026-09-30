import assert from "node:assert/strict";
import { test } from "node:test";
import { corroborateRecoveryMemberships, recoveryMembershipReader } from "./practice-recovery-whop";

test("read-only corroboration rejects unavailable, mismatched and nonterminal memberships", async t => {
  const oldCompany = process.env.WHOP_COMPANY_ID, oldPlan = process.env.WHOP_PLAN_ID;
  process.env.WHOP_COMPANY_ID = "biz_test";
  process.env.WHOP_PLAN_ID = "plan_test";
  const ownership = [
    { membershipId: "mem_keep", whopUserId: "user_keep" },
    { membershipId: "mem_end", whopUserId: "user_end" },
  ];
  const ended = { membershipId: "mem_end", status: "canceled" as const };
  let override: Record<string, unknown> = {};
  let unavailable = false;
  t.mock.method(recoveryMembershipReader, "retrieve", async (id: string) => {
    if (unavailable) throw new Error("secret response body");
    return {
      id, account: { id: "biz_test" }, plan_id: "plan_test",
      user_id: id === "mem_keep" ? "user_keep" : "user_end",
      status: id === "mem_keep" ? "active" : "canceled",
      cancel_at_period_end: false, current_period_end: null,
      ...(id === "mem_end" ? override : {}),
    };
  });
  try {
    const result = await corroborateRecoveryMemberships(ownership, ended);
    assert.equal(result.length, 2);
    assert.ok(result.every(row => Number.isFinite(Date.parse(row.checkedAt))));
    for (const bad of [
      { id: "mem_wrong" }, { account: null }, { account: { id: "biz_other" } },
      { plan_id: "plan_other" }, { user_id: null }, { user_id: "user_other" },
      { status: "active", cancel_at_period_end: true }, { status: "canceling" },
      { status: "past_due" }, { status: "unknown" }, { status: undefined },
    ]) {
      override = bad;
      await assert.rejects(corroborateRecoveryMemberships(ownership, ended));
    }
    override = { status: "expired", current_period_end: null };
    await assert.rejects(corroborateRecoveryMemberships(ownership, { ...ended, status: "expired" }), /expiry/);
    override.current_period_end = new Date(Date.now() + 60_000).toISOString();
    await assert.rejects(corroborateRecoveryMemberships(ownership, { ...ended, status: "expired" }), /expiry/);
    override.current_period_end = new Date(Date.now() - 60_000).toISOString();
    await corroborateRecoveryMemberships(ownership, { ...ended, status: "expired" });
    unavailable = true;
    await assert.rejects(corroborateRecoveryMemberships(ownership, ended), /^Error: Live Whop membership verification unavailable/);
    delete process.env.WHOP_COMPANY_ID;
    await assert.rejects(corroborateRecoveryMemberships(ownership, ended), /configured/);
  } finally {
    if (oldCompany === undefined) delete process.env.WHOP_COMPANY_ID; else process.env.WHOP_COMPANY_ID = oldCompany;
    if (oldPlan === undefined) delete process.env.WHOP_PLAN_ID; else process.env.WHOP_PLAN_ID = oldPlan;
  }
});