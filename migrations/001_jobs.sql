-- Coop AI job queue schema (PostgreSQL)

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  type VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  priority VARCHAR(20) NOT NULL,
  user_id VARCHAR(255),
  params JSONB NOT NULL DEFAULT '{}',
  result JSONB,
  error TEXT,
  progress INT NOT NULL DEFAULT 0,
  retry_count INT NOT NULL DEFAULT 0,
  scheduled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  estimated_duration_ms INT NOT NULL DEFAULT 120000
);

CREATE TABLE IF NOT EXISTS job_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  result JSONB NOT NULL,
  result_size INT NOT NULL DEFAULT 0,
  stored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  access_count INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS job_rate_limits (
  user_id VARCHAR(255) NOT NULL,
  job_type VARCHAR(50) NOT NULL,
  window_type VARCHAR(10) NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  job_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, job_type, window_type, window_start)
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_user_type ON jobs(user_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_results_job_id ON job_results(job_id);
CREATE INDEX IF NOT EXISTS idx_job_results_expires ON job_results(expires_at);
