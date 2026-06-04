-- CoopAI graph cache persistence (metadata snapshots)

CREATE TABLE IF NOT EXISTS graph_snapshots (
  repo_id VARCHAR(512) PRIMARY KEY,
  org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_graph_snapshots_org ON graph_snapshots(org_id);
CREATE INDEX IF NOT EXISTS idx_graph_snapshots_updated ON graph_snapshots(updated_at DESC);
