-- Stripe webhook idempotency: deduplicate event IDs on replay

BEGIN;

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id VARCHAR(255) PRIMARY KEY,
  event_type VARCHAR(128) NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
