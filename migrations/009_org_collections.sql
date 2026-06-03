-- Named repo collections for cross-repo indexing and query scoping

CREATE TABLE IF NOT EXISTS org_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_org_collections_org ON org_collections(org_id);

CREATE TABLE IF NOT EXISTS collection_repos (
  collection_id UUID NOT NULL REFERENCES org_collections(id) ON DELETE CASCADE,
  repo_id VARCHAR(512) NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection_id, repo_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_repos_repo ON collection_repos(repo_id);
