# Privileged practice membership recovery

This tool is the support interface. There is no public admin endpoint. Grant
access only to authorized billing support through individually authenticated
SSH/privileged sessions and least-privilege database credentials. Never share
the database credential with learners. The CLI records OS username plus
`PRACTICE_SUPPORT_SESSION` (the real privileged-access session/ticket ID).
Do not invent identities or run from a shared shell without an attributable
access session. Protect audit tables from UPDATE/DELETE for the support DB role;
permit SELECT/INSERT only. Application credentials are not an operator login.

## Deployment

This project uses Drizzle schema push (`pnpm --filter @workspace/db push`).
Review the generated additive changes and deploy them before API code. An
equivalent controlled SQL migration is in
`lib/db/migrations/202606_recover_practice_links.sql`; use either the schema push
or this migration, not ad-hoc DDL in tests. No existing learners are deleted.
Back up the database under normal production procedures. Do not roll back by
dropping the recovery tables: they prevent retired subscriptions reactivating.

## Inspect and verify

From `artifacts/api-server`, using the intended environment's DATABASE_URL:

1. Set `PRACTICE_SUPPORT_SESSION` to your authenticated access session reference.
2. `node recover-practice-link.mjs inspect CONFLICT_ID`
3. Confirm the canonical learner's Clerk identity is the customer's currently
   authenticated account, not an email pasted into a support message.
4. Independently verify **both** Whop membership owners out-of-band: open each
   membership in the authenticated provider dashboard, verify customer/account
   IDs and paid transaction records, and challenge the customer through their
   authenticated customer account/contact channel. Cookie possession, learner
   IDs, screenshots supplied by the customer, or knowing a membership ID alone
   are insufficient. Record restricted ticket evidence references for each.
   Never put card details, provider tokens, or sensitive documents in the JSON.
5. Ask the authenticated owner which membership to retain. End the duplicate
   with the provider using normal billing/refund policies. **Cancel-at-period-end
   is not ended.** Wait until access has ended and recurring billing is disabled.
   Inspect the live provider dashboard again. Record its membership/status,
   actual termination time, provider record reference, and verification time.
   Keep this audited manual provider-evidence gate in addition to the live API
   checks. Do not assert the booleans without performing these checks. If provider
   state is unavailable, contradictory, or ownership differs, STOP and escalate.
6. Write a mode-0600 operator-owned JSON evidence file with these fields:
   `ticket`, `authUserId`, `canonicalLearnerId`, `retainedMembershipId`,
   `ownership` (exactly two records, each with `membershipId`,
   `whopUserId` (the independently verified provider buyer ID, not a Clerk ID),
   `verifiedOwnerAuthUserId`, `evidenceReference`,
   `method: "provider_dashboard_and_authenticated_customer"`, `verifiedAt`),
   and `ended` with `membershipId`, `status` (`canceled` or `expired`),
   `recurringBillingDisabled: true`, `accessEnded: true`, `endedAt`,
   `verifiedAt`, `providerRecordReference`. All dates are ISO timestamps.
   Both owners must match the case's authenticated user. Verification must be
   within 24 hours; termination must already have occurred.
7. `node recover-practice-link.mjs verify CONFLICT_ID /secure/evidence.json`
   checks both memberships live, then records evidence and audit only; it does
   not consolidate usage. Existing evidence without buyer IDs must be reverified.

The connected Whop integration and `WHOP_COMPANY_ID` / `WHOP_PLAN_ID` must be
available in the operator environment. Both `verify` and `approve` perform
read-only membership retrievals with bounded timeouts and no retries. IDs,
seller, configured plan and independently verified buyer must match. Different
Whop buyer accounts are allowed only when each is independently verified as
belonging to the authenticated customer. Whop cannot establish Clerk ownership.
The duplicate must have the exact terminal `canceled`/`expired` state recorded
in the evidence; expiry additionally requires a past paid-through end. Immediate
cancellation can retain a future historical period end. The retained membership
must be active, trialing or completed. Scheduled cancellation alone is not proof
of termination. API failures, missing records, and mismatches block all changes;
there is no manual fallback or force flag. No provider cancellation, refund or
other write is performed. Successful checks store only minimal provider facts
and check timestamps in the audit, never the full provider response.

Rollout: retain all dashboard and authenticated-customer checks until support
has compared live checks with known cases in its intended environment. Automated
fixture tests do not certify real customer ownership. Do not relax the manual
process based solely on a passing API read.

## Explicit approval

Recheck the IDs and evidence with the customer and your billing policy:

`node recover-practice-link.mjs approve CONFLICT_ID CANONICAL_LEARNER_ID RETAINED_MEMBERSHIP_ID`

This explicitly approves and atomically resolves the case, sums **every**
usage period, retains before-state/usage/evidence in audit, preserves checkout
history and the anonymous tombstone, and records the retired membership.
Retries with the identical case and choices are idempotent. Different choices
are rejected. There is no force switch. Stale identities require investigation,
not direct SQL changes. The learner can then retry signing in on any device.

Late retained-membership webhooks continue to route to the canonical learner.
Retired-membership events and membership replacement via old checkout sessions
are ignored; event deduplication still applies. A legitimate repurchase may
replace a non-retired membership only when the local plan is free and status
is canceled/expired, and an activation references an unused pending checkout
created after termination (and after the paid-through end for expiry). Active
or canceling subscriptions cannot be displaced this way. Checkout consumption
is atomic with activation, so it cannot be reused after another expiry.
The same transaction advisory
lock protects linking, webhook updates, usage reservations/releases and
resolution. Archived usage is in the audit; the source usage rows are removed
only after the sum succeeds. Never delete aliases, retirement records or audit
history as cleanup. Apply normal restricted billing-record retention policies.

Inspect after resolution and confirm canonical usage and membership. Do not
promise refunds or cancellation merely because a local plan looks free.
No test should mutate shared customer records: integration tests create unique
fixtures and clean only their own rows in finally blocks.