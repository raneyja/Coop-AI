-- Durable repository dependency edges (import-parse, SCIP, workspace; no source bodies)

CREATE TABLE IF NOT EXISTS repo_dependency_edges (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repo_id VARCHAR(512) NOT NULL,
  from_path TEXT NOT NULL,
  to_path TEXT NOT NULL,
  kind VARCHAR(32) NOT NULL,
  symbol TEXT,
  line INT NOT NULL DEFAULT 0,
  source VARCHAR(32) NOT NULL,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, repo_id, from_path, to_path, kind, source, line)
);

CREATE INDEX IF NOT EXISTS idx_repo_dependency_edges_repo ON repo_dependency_edges (org_id, repo_id);
CREATE INDEX IF NOT EXISTS idx_repo_dependency_edges_to_path ON repo_dependency_edges (org_id, repo_id, to_path);
CREATE INDEX IF NOT EXISTS idx_repo_dependency_edges_from_path ON repo_dependency_edges (org_id, repo_id, from_path);
