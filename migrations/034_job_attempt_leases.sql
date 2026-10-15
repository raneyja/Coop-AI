-- Upgrade requires old workers to be stopped first. Mixed-version workers are unsafe.
ALTER TABLE jobs ADD COLUMN owner_id UUID;
ALTER TABLE jobs ADD COLUMN attempt_id UUID;
ALTER TABLE jobs ADD COLUMN lease_expires_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE jobs ADD COLUMN effect_quarantined BOOLEAN NOT NULL DEFAULT FALSE;
-- Legacy rows have no provable owner. Fail honestly instead of replaying unknown effects.
UPDATE jobs SET status = 'failed', completed_at = clock_timestamp(),
  error = 'Legacy running attempt has no lease; operator reconciliation required',
  effect_quarantined = type IN ('index_repository', 'build_dependency_graph', 'build_structure_manifest')
WHERE status = 'running';
ALTER TABLE jobs ADD CONSTRAINT jobs_running_attempt CHECK (
  status <> 'running' OR (owner_id IS NOT NULL AND attempt_id IS NOT NULL AND lease_expires_at IS NOT NULL)
);
CREATE INDEX idx_jobs_expiring_lease ON jobs (lease_expires_at) WHERE status = 'running';
CREATE INDEX idx_jobs_available ON jobs (available_at, created_at) WHERE status = 'queued';
