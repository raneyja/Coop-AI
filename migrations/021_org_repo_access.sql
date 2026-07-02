-- Admin-controlled repo indexing access: org policy + per-user grants.

BEGIN;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS repo_access_mode VARCHAR(32) NOT NULL DEFAULT 'all_indexed';

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_repo_access_mode_check;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_repo_access_mode_check
  CHECK (repo_access_mode IN ('all_indexed', 'per_user'));

CREATE TABLE IF NOT EXISTS user_repo_grants (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_id VARCHAR(512) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, user_id, repo_id)
);

CREATE INDEX IF NOT EXISTS idx_user_repo_grants_user
  ON user_repo_grants(org_id, user_id);

CREATE INDEX IF NOT EXISTS idx_user_repo_grants_repo
  ON user_repo_grants(org_id, repo_id);

COMMIT;
