-- Paid usage tiers (Pro / Pro+ / Max). Capability plan stays free|pro|enterprise.

BEGIN;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS usage_tier VARCHAR(32),
  ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(255);

UPDATE organizations
SET usage_tier = 'pro'
WHERE plan = 'pro' AND usage_tier IS NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_usage_tier
  ON organizations (usage_tier)
  WHERE usage_tier IS NOT NULL;

COMMIT;
