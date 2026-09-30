# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/api-server test` — run API regression tests against a fresh, disposable PostgreSQL database initialized from the current Drizzle schema. Requires Bash, Node.js, pnpm and PostgreSQL 16+ (`initdb` / `pg_ctl`) on PATH and a non-root user; the Replit modules already provide these. No database URL, AI credentials, Clerk credentials, or live provider accounts are required. The runner ignores inherited credentials, uses a private Unix socket (no TCP port), and stops PostgreSQL and removes all temporary data/bundles on success, failure, SIGINT, or SIGTERM. As with any cleanup trap, SIGKILL or host shutdown cannot be handled; leftover `/tmp/api-tests.*` directories can be removed after confirming their PostgreSQL process has stopped. Shared development data is never migrated. Use this same command in CI after installing dependencies and PostgreSQL.
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-server test:database-runner` — verify real PostgreSQL teardown after schema/test failures and SIGINT/SIGTERM, using controlled failing child commands.
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

### Automated API regression check

`.github/workflows/api-regression.yml` runs on pull requests, pushes, merge queues, and manual dispatches. Its **API regression tests** check installs locked dependencies with pnpm 10.26.1, uses Node.js 24 and PostgreSQL 16 tools on Ubuntu 24.04, and runs as the hosted runner's non-root user.

Both `pnpm --filter @workspace/api-server test` and `pnpm --filter @workspace/api-server test:database-runner` run even if the first suite fails; either nonzero exit fails the check. Neither command receives live credentials: CI passes only PATH, a fresh temporary HOME, LC_ALL and NODE_ENV through `env -i`. No repository secrets, provider accounts, or shared database services are configured. The existing disposable-database runner and test behavior are unchanged.

To enforce this before merging, select **API regression tests** as a required status check in the repository's branch protection/ruleset for protected branches (and require pull requests). Repository settings must be configured by a repository administrator; committing a workflow alone does not enforce merge protection. There are no path filters, so the required check also runs for changes outside the API directory.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
