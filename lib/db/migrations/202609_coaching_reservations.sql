-- Additive migration; existing aggregate usage is left unchanged.
CREATE TABLE IF NOT EXISTS practice_coaching_reservations (
  reservation_id text PRIMARY KEY,
  learner_id text NOT NULL REFERENCES practice_learners(learner_id) ON DELETE CASCADE,
  period_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS practice_coaching_reservations_recovery
  ON practice_coaching_reservations(status, expires_at);