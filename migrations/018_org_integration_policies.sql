-- Admin-controlled integration scope policies (channel/project allowlists).

BEGIN;

CREATE TABLE IF NOT EXISTS org_integration_policies (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL,
  policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_org_integration_policies_org
  ON org_integration_policies (org_id);

COMMIT;
