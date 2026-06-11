-- Usage telemetry for admin analytics and seat enforcement signals

BEGIN;

CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  user_id TEXT,
  principal TEXT NOT NULL,
  event_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_org_created
  ON usage_events (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_events_org_type_created
  ON usage_events (org_id, event_type, created_at DESC);

COMMIT;
