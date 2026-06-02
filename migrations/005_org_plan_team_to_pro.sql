-- Rename paid tier enum label team → pro (PostgreSQL 10+).
-- Existing rows keep the same enum member; no UPDATE required.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'org_plan' AND e.enumlabel = 'pro'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'org_plan' AND e.enumlabel = 'team'
  ) THEN
    RAISE NOTICE 'org_plan already has pro; skipping rename';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'org_plan' AND e.enumlabel = 'team'
  ) THEN
    RAISE EXCEPTION 'org_plan missing team value; cannot migrate to pro';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'org_plan' AND e.enumlabel = 'pro'
  ) THEN
    RAISE EXCEPTION 'org_plan has both team and pro; manual intervention required';
  END IF;

  ALTER TYPE org_plan RENAME VALUE 'team' TO 'pro';
END $$;

COMMIT;
