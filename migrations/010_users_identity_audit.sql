-- CoopAI per-user identity, Enterprise SSO config, sessions, and audit logging.
--
-- Adds human-user identity on top of the existing org-level model:
--   * users / org_memberships    -> who a person is and which orgs they belong to
--   * org_sso_config             -> per-org SAML IdP configuration (Enterprise only)
--   * user_sessions              -> hashed SSO session tokens (Free/Pro keep org API keys)
--   * audit_log                  -> every action: user_id, org_id, action, timestamp
--
-- Free/Pro org API key auth is untouched by this migration.

BEGIN;

-- ---------------------------------------------------------------------------
-- users: one row per human. idp_subject/idp_provider are NULL for non-SSO
-- (Free/Pro) users; populated for Enterprise SSO users.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(320) NOT NULL,
  idp_subject VARCHAR(255),
  idp_provider VARCHAR(32),
  role VARCHAR(32) NOT NULL DEFAULT 'member',
  last_login_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

-- One identity per email within an org (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_org_email
  ON users(org_id, lower(email));

-- An IdP subject is globally unique to one user (only when present).
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_idp_subject
  ON users(idp_provider, idp_subject)
  WHERE idp_subject IS NOT NULL;

-- ---------------------------------------------------------------------------
-- org_memberships: a user's membership + role within an org. Separate from
-- users.org_id so a user can later belong to more than one org without schema
-- changes (home org stays on users.org_id).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_memberships (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role VARCHAR(32) NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_org_memberships_org ON org_memberships(org_id);

-- ---------------------------------------------------------------------------
-- org_sso_config: per-org SAML 2.0 IdP configuration (Okta / Azure AD).
-- Enterprise-only at the API layer; one IdP per org.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_sso_config (
  org_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL,            -- 'okta' | 'azuread' | 'saml'
  idp_entity_id TEXT NOT NULL,
  idp_sso_url TEXT NOT NULL,
  idp_x509_cert TEXT NOT NULL,              -- PEM/base64 signing cert from the IdP
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- user_sessions: server-side session tokens issued after a successful SAML
-- login. Only the SHA-256 hash of the token is stored (same scheme as
-- api_keys.key_hash). Revoked immediately when a user is deactivated.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash VARCHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

-- ---------------------------------------------------------------------------
-- audit_log: append-only record of every authenticated action.
--   user_id   -> human user (NULL for org API key / legacy / dev requests)
--   org_id    -> TEXT (not FK) so 'legacy'/'dev' synthetic orgs are loggable
--   principal -> who/what acted, e.g. 'user:<uuid>' or 'apikey:<keyId>'
--   action    -> stable verb, e.g. 'chat.completion', 'job.create'
-- ---------------------------------------------------------------------------
-- org_id is TEXT (not UUID FK) to support synthetic org identifiers ('legacy', 'dev') used by API-key and dev auth paths.
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  org_id TEXT NOT NULL,
  principal VARCHAR(128),
  action VARCHAR(128) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_org_time ON audit_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_time ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);

COMMIT;
