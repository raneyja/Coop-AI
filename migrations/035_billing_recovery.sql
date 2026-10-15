BEGIN;

ALTER TABLE stripe_webhook_events
  ADD COLUMN attempt_token UUID,
  ADD COLUMN lease_expires_at TIMESTAMPTZ,
  ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN resource_id TEXT,
  ADD COLUMN customer_id TEXT,
  ADD COLUMN retry_after TIMESTAMPTZ;
CREATE INDEX stripe_webhook_recovery_idx ON stripe_webhook_events(status, lease_expires_at, retry_after);

CREATE TABLE billing_checkout_receipts (
  session_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  org_id UUID NOT NULL REFERENCES organizations(id),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE billing_email_outbox (
  delivery_key TEXT PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL CHECK (kind IN ('welcome','upgrade')),
  encrypted_payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','uncertain')),
  attempt_token UUID,
  lease_expires_at TIMESTAMPTZ,
  first_attempt_at TIMESTAMPTZ,
  retry_after TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX billing_email_recovery_idx ON billing_email_outbox(status, lease_expires_at, retry_after);

COMMIT;
