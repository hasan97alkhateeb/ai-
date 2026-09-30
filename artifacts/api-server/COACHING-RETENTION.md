# Coaching reservation retention

- Keep succeeded and released reservations for **90 days after settlement**.
  This covers roughly three monthly support cycles; monthly usage totals are
  retained independently and are never recalculated from this ledger.
- Pending reservations are never pruned, regardless of age. Lease recovery
  releases/refunds them first and starts a new 90-day support window.
- The API prunes at startup and once per minute, at most **500 rows per run**.
  It skips locked rows and prevents overlapping runs in the same process.
  Multiple instances may each process a batch safely. Failures are logged and
  retried on the next tick; there is no unbounded drain loop.
- Logs report deleted counts and failures. After deletion, per-request history
  is unavailable; absence of a reservation is not proof that it never existed.
- A delayed release of a deleted ID is a no-op. A delayed completion rejects,
  just as it does for an already-settled ID. Neither can change monthly usage,
  recreate a reservation, or authorize delivery of uncharged feedback.

## Maintenance monitoring

- Recovery remains capped at **100 expired pending reservations per run**;
  retention remains capped at **500 settled rows per run**. Both workers run
  once per minute and retry after failures.
- A separate probe runs at startup and every **5 minutes**. It uses the
  recovery index to inspect at most 101 expired pending rows, and the retention
  index to inspect at most 501 eligible rows per settled status. It reports
  counts as lower bounds once a batch is exceeded; it does not scan learner
  requests or try to drain the backlog.
- Structured warning logs are emitted when an expired pending reservation is
  at least **5 minutes past expiry**, the pending backlog exceeds 100, or
  recovery has not succeeded in 5 minutes. Inspect database availability and
  the recovery failure logs first.
- Retention warnings are emitted when eligible history exceeds 500 rows, the
  oldest eligible settlement is more than **24 hours beyond the 90-day
  retention window**, or pruning has not succeeded in 5 minutes. Inspect
  database availability and the retention failure logs first.
- Warning records include the oldest observed timestamps, age, bounded backlog
  lower bound, batch capacity, and time of the last successful run. Successful
  run timestamps are stored per maintenance job in
  `practice_coaching_maintenance`, using database time and committed in the
  same transaction as each recovery or retention batch. A process restart does
  not reset the warning baseline. If a newly installed database has no success
  record yet, the warning's last-success field is null and elapsed time uses
  process start as a temporary baseline until the first successful run. Probe
  failures are logged separately and retried at the next probe.

## Rollout

Apply the Drizzle schema through the normal development schema push before
starting the new API. The change is additive; existing rows receive a fresh
retention window rather than being immediately deleted. PostgreSQL's constant
default avoids a table-wide UPDATE. The retention index matches the batch
ordering, including the ID tie-breaker for rows with identical timestamps.
For Replit-managed production databases, re-publish to apply the development
schema through the normal Publish flow; do not run startup-time DDL.

The `settled_at` default is only a compatibility placeholder on pending rows;
all settlement paths overwrite it with database time. Never use it as evidence
of settlement without checking status.