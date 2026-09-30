---
name: Coaching maintenance heartbeat
description: Durable success timestamps for reservation recovery and retention warnings
---

Maintenance warnings that depend on the time of the last successful run must use database-backed timestamps committed atomically with the maintenance operation. Process-local timestamps reset on restart and can suppress or distort stale-run warnings.

**Why:** An API restart can occur after a long maintenance outage. Resetting the warning clock at process start hides that stale state even though the reservation ledger still persists.

**How to apply:** Persist each job's success time in the same transaction as its recovery or retention work. Use process start only as a first-deployment fallback when no durable success record exists, and account for in-flight work to avoid false alarms during startup.