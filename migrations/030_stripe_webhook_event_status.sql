-- A Stripe event row means "in progress" or "failed" until the handler finishes.
-- Historical rows default to completed so they are not replayed.

BEGIN;

ALTER TABLE stripe_webhook_events
  ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'completed';

COMMIT;
