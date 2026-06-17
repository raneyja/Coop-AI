-- Per-user workspace repo selection (up to 3 repos per seat on Pro/Enterprise).
-- Org-wide indexing lives on org_repos; this table is each developer's working set.

CREATE TABLE IF NOT EXISTS user_workspace_repos (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  repo_id VARCHAR(512) NOT NULL,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, user_id, repo_id)
);

CREATE INDEX IF NOT EXISTS idx_user_workspace_repos_user
  ON user_workspace_repos(org_id, user_id);

CREATE INDEX IF NOT EXISTS idx_user_workspace_repos_repo
  ON user_workspace_repos(org_id, repo_id);
