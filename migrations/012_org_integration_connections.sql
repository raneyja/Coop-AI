-- Org-scoped OAuth connections for Slack, Atlassian, and future integrations.

BEGIN;

CREATE TABLE IF NOT EXISTS org_integration_connections (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_org_integration_connections_org
  ON org_integration_connections (org_id);

COMMIT;
