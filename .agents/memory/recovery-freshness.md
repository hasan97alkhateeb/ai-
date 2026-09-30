---
name: Recovery freshness budget
description: Safety and responsiveness tradeoffs for two-phase provider corroboration
---
Bound recovery verification to a short monotonic budget that includes both provider latency and waiting to reacquire the shared lock. A 30-second budget leaves headroom above the parallel 12-second provider timeouts without treating old checks as current.

**Why:** Timestamping only the final provider response hides time spent on earlier reads or waiting for local transactions. Holding a database connection during provider reads would also let slow support checks exhaust resources needed by learners.

**How to apply:** Reject expired snapshots rather than silently retrying approval. Snapshot identity and evidence, not usage: usage must continue changing during provider reads and be consolidated from current rows atomically at commit. Preserve same-result idempotency for concurrent approvals without repeating audit or consolidation writes.