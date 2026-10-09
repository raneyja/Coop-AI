BEGIN;
CREATE TABLE IF NOT EXISTS support_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  principal TEXT NOT NULL,
  submission_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bug', 'feedback', 'feature_request')),
  title VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  contact_email VARCHAR(320) NOT NULL,
  diagnostics JSONB,
  diagnostics_expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  assignee_id UUID REFERENCES operators(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revision INTEGER NOT NULL DEFAULT 0,
  resolved_at TIMESTAMPTZ,
  notification_status TEXT NOT NULL DEFAULT 'pending' CHECK (notification_status IN ('pending', 'sent', 'failed', 'mocked')),
  notification_attempts INTEGER NOT NULL DEFAULT 0,
  notification_next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, principal, submission_id)
);
CREATE INDEX IF NOT EXISTS support_reports_queue ON support_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS support_reports_principal ON support_reports(org_id, principal, created_at DESC);
CREATE INDEX IF NOT EXISTS support_reports_notification ON support_reports(notification_next_attempt_at) WHERE notification_status = 'pending';
CREATE TABLE IF NOT EXISTS support_report_events (
  id BIGSERIAL PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES support_reports(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  status TEXT NOT NULL,
  assignee_id UUID REFERENCES operators(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMIT;
