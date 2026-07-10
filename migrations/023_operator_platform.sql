-- Operator platform: cross-org ops identity, audit, enterprise leads, org metadata.

BEGIN;

CREATE TABLE IF NOT EXISTS operators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(320) NOT NULL,
  name VARCHAR(255),
  role VARCHAR(32) NOT NULL DEFAULT 'viewer',
  google_sub VARCHAR(255),
  last_login_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT operators_role_check CHECK (role IN ('viewer', 'support', 'billing', 'super_admin'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_operators_email ON operators (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS uq_operators_google_sub ON operators (google_sub) WHERE google_sub IS NOT NULL;

CREATE TABLE IF NOT EXISTS operator_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operator_sessions_operator ON operator_sessions(operator_id);
CREATE INDEX IF NOT EXISTS idx_operator_sessions_expires ON operator_sessions(expires_at);

CREATE TABLE IF NOT EXISTS operator_audit_log (
  id BIGSERIAL PRIMARY KEY,
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  action VARCHAR(128) NOT NULL,
  target_org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operator_audit_operator_time ON operator_audit_log(operator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operator_audit_org_time ON operator_audit_log(target_org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operator_audit_action ON operator_audit_log(action);

CREATE TABLE IF NOT EXISTS enterprise_upgrade_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  company_name VARCHAR(255) NOT NULL,
  contact_email VARCHAR(320) NOT NULL,
  message TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enterprise_upgrade_status ON enterprise_upgrade_requests(status, created_at DESC);

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS operator_status VARCHAR(32) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS crm_external_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS operator_notes TEXT,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT,
  ADD COLUMN IF NOT EXISTS provenance VARCHAR(32) NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS assignee_operator_id UUID REFERENCES operators(id) ON DELETE SET NULL;

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_operator_status_check;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_operator_status_check
  CHECK (operator_status IN ('active', 'suspended'));

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_provenance_check;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_provenance_check
  CHECK (provenance IN ('unknown', 'stripe_checkout', 'free_signup', 'manual_enterprise', 'manual_pro'));

COMMIT;
