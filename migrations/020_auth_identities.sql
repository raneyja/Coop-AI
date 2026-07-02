-- Human auth: email/password, Google OAuth, and session metadata.
-- Org API keys (api_keys) remain for automation; human sign-in uses user_sessions.

BEGIN;

CREATE TABLE IF NOT EXISTS auth_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL,
  provider_subject VARCHAR(255),
  credential_hash TEXT,
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_identities_provider_subject
  ON auth_identities(provider, provider_subject)
  WHERE provider_subject IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_identities_user_provider
  ON auth_identities(user_id, provider);

CREATE INDEX IF NOT EXISTS idx_auth_identities_user ON auth_identities(user_id);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash VARCHAR(64) PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  purpose VARCHAR(32) NOT NULL,
  metadata JSONB,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_purpose ON auth_tokens(user_id, purpose);

ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(32);

ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS org_auth_policy (
  org_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  require_sso BOOLEAN NOT NULL DEFAULT FALSE,
  allow_password BOOLEAN NOT NULL DEFAULT TRUE,
  allow_google BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
