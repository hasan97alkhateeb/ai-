---
name: Coaching recovery safety
description: Safety tradeoff for coaching allowance recovery during database outages.
---

Coaching recovery must be authorized by a durable reservation created before the provider call, not by a failure marker written afterward. Return feedback only after durable success settlement; reject results that arrive after recovery has reclaimed their reservation.

**Why:** The same database outage that prevents a refund can also prevent recording the need for a refund. A pre-existing lease survives both failures and process restarts. Failing closed for late responses is intentional: successful feedback must never be delivered with an allowance charge that recovery can undo.

**How to apply:** Preserve the settlement-before-response boundary when changing provider timeouts, streaming, or retries. A streaming design needs a new accounting contract before exposing feedback early. Account merges must preserve pending reservations along with their usage.

Retention should be measured from settlement, not lease expiry, and legacy
settlements should get a full support window when retention is introduced.

**Why:** An old pending lease can be recovered today after a long outage.
Deleting it based on its original expiry would erase newly relevant support
evidence immediately. Historical rows without a settlement date should not
be purged on rollout.

**How to apply:** Keep this distinction when changing the support window or
migrating the ledger. A missing/pruned ID must never authorize success or a refund.