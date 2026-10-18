BEGIN;
CREATE TABLE chat_source_turns (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_binding CHAR(64) NOT NULL,
  client_turn_id VARCHAR(160) NOT NULL,
  active_call_id UUID NOT NULL,
  identity_hash CHAR(64) NOT NULL,
  evidence_id CHAR(64) NOT NULL,
  task_hash CHAR(64) NOT NULL,
  synthesis_hash CHAR(64) NOT NULL,
  synthesis_length INTEGER NOT NULL CHECK (synthesis_length > 0),
  use_case VARCHAR(32) NOT NULL,
  state VARCHAR(8) NOT NULL CHECK (state IN ('busy','ready','closed')),
  review_calls INTEGER NOT NULL DEFAULT 0 CHECK (review_calls BETWEEN 0 AND 64),
  repair_calls INTEGER NOT NULL DEFAULT 0 CHECK (repair_calls BETWEEN 0 AND 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() + INTERVAL '15 minutes',
  UNIQUE (org_id, actor_binding, client_turn_id)
);
CREATE INDEX chat_source_turns_expiry_idx ON chat_source_turns (expires_at);
CREATE UNIQUE INDEX chat_usage_call_once_idx ON usage_events (org_id,event_type,(metadata->>'billingCallId'))
  WHERE event_type='chat.message' AND metadata ? 'billingCallId';
CREATE TABLE chat_ordinary_turns (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_binding CHAR(64) NOT NULL,
  client_turn_id VARCHAR(160) NOT NULL,
  task_hash CHAR(64) NOT NULL,
  identity_hash CHAR(64) NOT NULL,
  answer_use_case VARCHAR(32) NOT NULL,
  state VARCHAR(20) NOT NULL CHECK (state IN ('gather','answer_busy','continuation_ready','continue_busy','closed')),
  plan_calls INTEGER NOT NULL DEFAULT 0 CHECK (plan_calls BETWEEN 0 AND 8),
  continuation_hash CHAR(64),
  interpret_calls INTEGER NOT NULL DEFAULT 0 CHECK (interpret_calls BETWEEN 0 AND 18),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() + INTERVAL '15 minutes',
  UNIQUE(org_id,actor_binding,client_turn_id)
);
CREATE INDEX chat_ordinary_turns_expiry_idx ON chat_ordinary_turns(expires_at);
-- A capped subject can have only one unsettled provider call. Expiry is not
-- evidence of zero spend: uncertain calls remain blocked pending reconciliation.
CREATE TABLE chat_cost_admissions (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subject VARCHAR(80) NOT NULL,
  billing_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  state VARCHAR(12) NOT NULL CHECK (state IN ('pending','dispatched','unresolved','settled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  settled_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX chat_cost_subject_unsettled_idx ON chat_cost_admissions(org_id,subject)
  WHERE state <> 'settled';
COMMIT;
