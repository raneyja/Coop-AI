-- Post-index browse verification: prove developers can open the repo on the
-- real default branch before admin treats it as "Usable".

ALTER TABLE org_repos
  ADD COLUMN IF NOT EXISTS browse_status VARCHAR(16),
  ADD COLUMN IF NOT EXISTS browse_error TEXT,
  ADD COLUMN IF NOT EXISTS browse_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS default_branch VARCHAR(255);

COMMENT ON COLUMN org_repos.browse_status IS
  'pending | verified | failed — live code-host tree check after Deep-Index';
COMMENT ON COLUMN org_repos.default_branch IS
  'Default branch resolved during browse verification (e.g. preview, main)';
