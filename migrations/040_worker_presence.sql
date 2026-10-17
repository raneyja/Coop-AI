-- Process presence is independent of job leases: an idle worker must renew too.
BEGIN;
CREATE TABLE public.worker_presence (
  instance_id UUID PRIMARY KEY,
  fleet_id VARCHAR(64) NOT NULL CHECK (fleet_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  bundle_sha256 CHAR(64) NOT NULL CHECK (bundle_sha256 ~ '^[0-9a-f]{64}$'),
  accepting_work BOOLEAN NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  active_jobs INTEGER NOT NULL CHECK (active_jobs >= 0 AND active_jobs <= capacity),
  observed_at TIMESTAMPTZ NOT NULL,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  CHECK (lease_expires_at > observed_at AND lease_expires_at <= observed_at + INTERVAL '15 seconds')
);
CREATE INDEX worker_presence_fleet_lease_idx ON public.worker_presence (fleet_id, lease_expires_at);
COMMIT;
