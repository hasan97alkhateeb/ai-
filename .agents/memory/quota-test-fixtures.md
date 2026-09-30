---
name: Quota test fixtures
description: Database fixture constraints for practice coaching quota regression tests.
---

Quota integration tests should use unique learner IDs, insert only the stable fields they need, and delete fixture learners in `finally` so dependent usage rows cascade away. Do not change a shared database schema solely to make a focused test fixture work.

**Why:** Development database schemas can lag nullable account-linking fields. Updating shared schema during a quota test task would introduce unrelated, persistent state changes.

**How to apply:** When adding quota tests, keep fixtures isolated and cleanup deterministic; investigate schema drift separately instead of applying ad hoc DDL.

When development schema drift prevents integration tests from running, verify against a disposable local PostgreSQL instance initialized from the current Drizzle schema instead of migrating the shared development database.

**Why:** This verifies real SQL and account-linking behavior without changing application data or weakening tests by mocking database operations.

**How to apply:** Scope the test database connection override to the verification process, and stop and remove the disposable instance afterward.