-- Mixed Pro / Pro+ / Max seats: per-person usage_tier, purchased inventory,
-- and member upgrade requests. Occupied seats include deactivated users.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS usage_tier VARCHAR(32);

UPDATE users u
SET usage_tier = o.usage_tier
FROM organizations o
WHERE u.org_id = o.id
  AND o.plan = 'pro'
  AND u.usage_tier IS NULL
  AND o.usage_tier IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_org_usage_tier
  ON users (org_id, usage_tier)
  WHERE usage_tier IS NOT NULL;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS seat_inventory_pro INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seat_inventory_pro_plus INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seat_inventory_max INTEGER NOT NULL DEFAULT 0;

UPDATE organizations
SET
  seat_inventory_pro = CASE
    WHEN plan = 'pro' AND COALESCE(usage_tier, 'pro') = 'pro' THEN GREATEST(seat_count, 1)
    ELSE seat_inventory_pro
  END,
  seat_inventory_pro_plus = CASE
    WHEN plan = 'pro' AND usage_tier = 'pro_plus' THEN GREATEST(seat_count, 1)
    ELSE seat_inventory_pro_plus
  END,
  seat_inventory_max = CASE
    WHEN plan = 'pro' AND usage_tier = 'max' THEN GREATEST(seat_count, 1)
    ELSE seat_inventory_max
  END
WHERE plan = 'pro'
  AND seat_inventory_pro = 0
  AND seat_inventory_pro_plus = 0
  AND seat_inventory_max = 0;

CREATE INDEX IF NOT EXISTS idx_usage_events_org_user_created
  ON usage_events (org_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS seat_upgrade_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_tier VARCHAR(32) NOT NULL,
  to_tier VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_seat_upgrade_requests_pending_user
  ON seat_upgrade_requests (user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_seat_upgrade_requests_org_status
  ON seat_upgrade_requests (org_id, status, created_at DESC);

COMMIT;
