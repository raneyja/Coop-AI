-- GitHub App (and future code host app) installation tokens per organization

CREATE TABLE IF NOT EXISTS code_host_installations (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL,
  installation_id BIGINT NOT NULL,
  encrypted_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, provider)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_code_host_installations_installation
  ON code_host_installations (installation_id, provider);

CREATE INDEX IF NOT EXISTS idx_code_host_installations_org
  ON code_host_installations (org_id);
