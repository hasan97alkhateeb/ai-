---
name: Practice browser auth boundary
description: What the deterministic browser isolation suite does and does not verify about Clerk.
---

The CI browser suite uses a test-only Clerk module alias and test identity header. It verifies the real practice page, database-backed routes, and learner-specific history/progress in independent browser contexts, but it does not verify Clerk token issuance or validation.

**Why:** The supported Replit Clerk sign-in helper is an interactive browser capability and is not available to the isolated CI runner. CI must stay deterministic and must not depend on credentials or external AI calls.

**How to apply:** Keep the identity alias and API header confined to the E2E test config/boundary. Use the supported Clerk browser sign-in helper separately when it is available to verify real session integration; never present the CI shim as real Clerk authentication coverage.