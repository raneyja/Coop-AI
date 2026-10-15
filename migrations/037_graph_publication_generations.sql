-- Ordered graph publication only. This is not a coherent generation of every
-- SCIP/embedding/Zoekt artifact. Legacy payloads remain explicitly unattested.
CREATE TABLE graph_publication_heads (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repo_id VARCHAR(512) NOT NULL,
  requested_generation BIGINT NOT NULL DEFAULT 0 CHECK (requested_generation >= 0),
  published_generation BIGINT NOT NULL DEFAULT 0 CHECK (published_generation >= 0),
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  tombstone BOOLEAN NOT NULL DEFAULT FALSE,
  requested_job_id UUID,
  published_job_id UUID,
  origin TEXT NOT NULL DEFAULT 'legacy-unattested',
  PRIMARY KEY (org_id, repo_id),
  CHECK (published_generation <= requested_generation)
);
INSERT INTO graph_publication_heads (org_id, repo_id)
SELECT org_id, repo_id FROM graph_snapshots;
ALTER TABLE graph_snapshots ADD COLUMN generation BIGINT NOT NULL DEFAULT 0 CHECK (generation >= 0);
ALTER TABLE graph_snapshots ADD COLUMN revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0);
ALTER TABLE graph_snapshots ADD COLUMN origin TEXT NOT NULL DEFAULT 'legacy-unattested';
ALTER TABLE jobs ADD COLUMN graph_generations JSONB;
-- NULL means a historical job has no generation authority. Do not invent it.
