-- Shared sign-in counters. Hashed peer buckets expire logically; bounded per-request cleanup reclaims expired rows.
BEGIN;
CREATE TABLE public.auth_rate_limits (
  key_hash TEXT PRIMARY KEY CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  attempts INTEGER NOT NULL CHECK (attempts BETWEEN 1 AND 1001),
  reset_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX auth_rate_limits_reset_at_idx ON public.auth_rate_limits (reset_at);
COMMIT;
