-- Integration admission and refresh bind to one durable credential generation.
BEGIN;

ALTER TABLE public.org_integration_connections
  ADD COLUMN revision UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid();

CREATE FUNCTION public.advance_integration_connection_revision()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Also fences legacy INSERT/ON CONFLICT/UPDATE callers and caller-supplied IDs.
  NEW.revision := pg_catalog.gen_random_uuid();
  RETURN NEW;
END;
$$;

CREATE TRIGGER org_integration_connection_revision
BEFORE INSERT OR UPDATE ON public.org_integration_connections
FOR EACH ROW EXECUTE FUNCTION public.advance_integration_connection_revision();

COMMIT;
