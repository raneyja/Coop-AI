-- Pro Lightning Mode symbol graph (SCIP + tree-sitter fallback; no source bodies)

CREATE TABLE IF NOT EXISTS repo_symbol_index (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repo_id VARCHAR(512) NOT NULL,
  symbol TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line_start INT NOT NULL,
  line_end INT NOT NULL,
  kind VARCHAR(32) NOT NULL,
  "references" JSONB NOT NULL DEFAULT '[]'::jsonb,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, repo_id, symbol, file_path, line_start)
);

CREATE INDEX IF NOT EXISTS idx_repo_symbol_index_repo ON repo_symbol_index (org_id, repo_id);
CREATE INDEX IF NOT EXISTS idx_repo_symbol_index_file ON repo_symbol_index (org_id, repo_id, file_path);
