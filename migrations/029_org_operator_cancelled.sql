-- Allow operators to cancel a customer without deleting the org row.
-- Cancelled orgs stay in history; users are offboarded so they can sign up again.

BEGIN;

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_operator_status_check;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_operator_status_check
  CHECK (operator_status IN ('active', 'suspended', 'cancelled'));

COMMIT;
