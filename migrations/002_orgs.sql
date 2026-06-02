-- CoopAI organizations, API keys, credentials, and Lightning repo registry

CREATE TYPE org_plan AS ENUM ('free', 'team', 'enterprise');

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  plan org_plan NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key_hash VARCHAR(64) NOT NULL UNIQUE,
  label VARCHAR(255) NOT NULL DEFAULT 'default',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(org_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS org_credentials (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL,
  encrypted_token TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, provider)
);

CREATE TYPE index_status AS ENUM ('idle', 'queued', 'indexing', 'ready', 'error', 'disabled');

CREATE TABLE IF NOT EXISTS org_repos (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repo_id VARCHAR(512) NOT NULL,
  lightning_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  index_status index_status NOT NULL DEFAULT 'idle',
  last_indexed_at TIMESTAMPTZ,
  last_job_id UUID,
  error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, repo_id)
);

CREATE INDEX IF NOT EXISTS idx_org_repos_org ON org_repos(org_id);
CREATE INDEX IF NOT EXISTS idx_org_repos_status ON org_repos(org_id, index_status);
