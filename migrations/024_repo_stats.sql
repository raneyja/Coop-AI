-- Durable repository facts captured during INDEX_REPOSITORY while the transient
-- clone still exists (counts and languages only, no source bodies).
-- Canonical inventory source for chat repo-fact questions.

CREATE TABLE IF NOT EXISTS repo_stats (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repo_id VARCHAR(512) NOT NULL,
  branch VARCHAR(255),
  file_count INTEGER NOT NULL,
  line_count BIGINT NOT NULL,
  byte_count BIGINT NOT NULL,
  languages JSONB NOT NULL DEFAULT '[]'::jsonb,
  head_commit VARCHAR(64),
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, repo_id)
);

CREATE INDEX IF NOT EXISTS idx_repo_stats_repo ON repo_stats (org_id, repo_id);
