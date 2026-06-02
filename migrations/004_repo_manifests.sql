-- Zero-Clone repo structure manifests (paths + symbols only, no source bodies)

CREATE TABLE IF NOT EXISTS repo_manifests (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repo_id VARCHAR(512) NOT NULL,
  file_path TEXT NOT NULL,
  symbols JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_crawled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, repo_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_repo_manifests_repo ON repo_manifests (org_id, repo_id);
