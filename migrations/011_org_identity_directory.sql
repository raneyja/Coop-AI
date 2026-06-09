-- Org-scoped identity directory: explicit links between people and tool accounts.
BEGIN;

CREATE TABLE IF NOT EXISTS org_identity_directories (
  org_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  directory JSONB NOT NULL DEFAULT '{"version":1,"people":[]}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_identity_directories_updated
  ON org_identity_directories(updated_at DESC);

COMMIT;
