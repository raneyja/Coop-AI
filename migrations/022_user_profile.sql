-- User profile fields for invite signup and member onboarding.
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(128);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(128);
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_onboarding_completed_at TIMESTAMPTZ;

COMMIT;
