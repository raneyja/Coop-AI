-- Partition graph snapshots by organization.
-- Rows with a null org_id cannot be attributed to a tenant and are dropped.
-- Do not invent an org for them.

BEGIN;

DELETE FROM graph_snapshots WHERE org_id IS NULL;

ALTER TABLE graph_snapshots DROP CONSTRAINT IF EXISTS graph_snapshots_pkey;
ALTER TABLE graph_snapshots ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE graph_snapshots ADD PRIMARY KEY (org_id, repo_id);

ALTER TABLE graph_snapshots DROP CONSTRAINT IF EXISTS graph_snapshots_org_id_fkey;
ALTER TABLE graph_snapshots
  ADD CONSTRAINT graph_snapshots_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;

COMMIT;
