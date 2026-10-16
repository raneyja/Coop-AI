-- Pending SP-initiated logins. Only opaque state/browser hashes are persisted.
CREATE TABLE saml_login_requests (
  request_id TEXT PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  relay_hash TEXT NOT NULL UNIQUE,
  browser_hash TEXT,
  config_hash TEXT NOT NULL,
  authorize_url TEXT NOT NULL,
  redirect TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('login', 'test')),
  request_instant TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX saml_login_requests_expiry_idx ON saml_login_requests(expires_at);

-- Contract change: SAML old replicas must be drained/disabled during rollout.
-- Existing identities retain their recorded home org; do not invent a backfill.
CREATE UNIQUE INDEX uq_users_org_idp_subject ON users(org_id, idp_provider, idp_subject)
  WHERE idp_subject IS NOT NULL;
DROP INDEX uq_users_idp_subject;

-- Old SAML sessions lack a configuration binding and require fresh sign-in.
ALTER TABLE user_sessions ADD COLUMN saml_config_hash TEXT;

-- Exact configuration epoch: timestamps alone lose precision in JS and are not a version.
ALTER TABLE org_sso_config ADD COLUMN auth_version BIGINT NOT NULL DEFAULT 1;
CREATE FUNCTION bump_sso_auth_version() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.auth_version := OLD.auth_version + 1;
  RETURN NEW;
END;
$$;
CREATE TRIGGER org_sso_auth_version BEFORE UPDATE ON org_sso_config
  FOR EACH ROW EXECUTE FUNCTION bump_sso_auth_version();
