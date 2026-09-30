-- Additive equivalent of the Drizzle schema; production normally uses db:push.
-- Apply once through your controlled migration connection before deploying API.
BEGIN;
CREATE TABLE IF NOT EXISTS practice_link_conflicts (
  conflict_id text PRIMARY KEY, auth_user_id text NOT NULL,
  canonical_learner_id text NOT NULL, anonymous_learner_id text NOT NULL,
  account_membership_id text NOT NULL, anonymous_membership_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending', retained_membership_id text,
  evidence jsonb, created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS practice_link_conflict_pair
  ON practice_link_conflicts(canonical_learner_id, anonymous_learner_id);
CREATE TABLE IF NOT EXISTS practice_link_audit (
  audit_id text PRIMARY KEY, conflict_id text NOT NULL, operator text NOT NULL,
  action text NOT NULL, details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS practice_learner_aliases (
  learner_id text PRIMARY KEY, canonical_learner_id text NOT NULL
);
CREATE TABLE IF NOT EXISTS practice_retired_memberships (
  membership_id text PRIMARY KEY, conflict_id text NOT NULL, canonical_learner_id text NOT NULL
);
COMMIT;