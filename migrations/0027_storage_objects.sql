-- =============================================================================
-- 0027_storage_objects — files kept in Postgres (STORAGE_DRIVER=pg).
--
-- For hosts with a database but no object store set up yet (2026-11-19: the
-- first Vercel + Supabase deploy, where the database string is all there is).
-- Same contract as the other drivers: keys are tenant-prefixed
-- (tenants/<tenant_id>/...), reads go through /api/storage with a signed,
-- short-lived link. tenant_id is taken from the key, and the table has the
-- same tenant_isolation policy as every table (RLS, INV-1). Platform admins
-- may list across workspaces for housekeeping (lib/storage/sweep).
-- =============================================================================

CREATE TABLE storage_objects (
  key         text PRIMARY KEY CONSTRAINT storage_objects_key_check CHECK (key LIKE 'tenants/%' AND length(key) <= 1024),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mime        text NOT NULL,
  bytes       integer NOT NULL,
  data        bytea NOT NULL,
  modified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_storage_objects_tenant ON storage_objects (tenant_id);
CREATE INDEX idx_storage_objects_key_prefix ON storage_objects (key text_pattern_ops);

ALTER TABLE storage_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON storage_objects
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY admin_read ON storage_objects FOR SELECT USING (app_is_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON storage_objects TO huemen_app;
