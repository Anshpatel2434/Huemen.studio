-- =============================================================================
-- 0002_rls — Row-Level Security. The PRIMARY line of tenant isolation (INV-1,
-- brief §07). Application-layer filtering (src/db/session.ts) is the second line,
-- never the only one.
--
-- Model:
--   * app.current_tenant     — the workspace the session may see.
--   * app.is_platform_admin  — Owner/Admin platform users (brief §02).
--   Both GUCs are set server-side from VERIFIED session claims (never client
--   input) by withTenantSession(). Set with set_config(..., true) => tx-local.
--
--   * Every table: tenant_isolation policy — rows visible/writable only when
--     tenant_id = app.current_tenant.
--   * Admin-managed tables ONLY (workspaces, users, assignments, caps, global
--     prompt templates, logs, jobs, audit): an ADDITIONAL admin policy. Client
--     CONTENT tables (brand_profiles, content_items, images, ideas, calendar,
--     offers, voice, visual, assets, pillars, generations) get NO admin bypass —
--     so even an admin-code bug cannot leak one client's content to another.
-- =============================================================================

CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_tenant', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_is_admin() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.is_platform_admin', true) = 'true'
$$;

-- Enable + FORCE RLS and attach the standard tenant-isolation policy to every
-- tenant-scoped table (i.e. all of them).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants','users','coach_assignments','brand_profiles','voice_guides',
    'assets','visual_identities','pillars','prompt_templates','content_items',
    'content_generations','image_assets','ideas','calendar_entries','offers',
    'generation_logs','tenant_usage_caps','admin_audit_log','jobs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = app_current_tenant())
        WITH CHECK (tenant_id = app_current_tenant())
    $f$, t);
  END LOOP;
END $$;

-- Global prompt templates (tenant_id IS NULL) are shared config, readable by all
-- tenants. Writable only via the admin policy below.
CREATE POLICY global_templates_readable ON prompt_templates
  FOR SELECT USING (tenant_id IS NULL);

-- Additional admin policies — workspace management + analytics only.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants','users','coach_assignments','tenant_usage_caps',
    'prompt_templates','generation_logs','admin_audit_log','jobs'
  ] LOOP
    EXECUTE format($f$
      CREATE POLICY admin_all ON %I
        USING (app_is_admin())
        WITH CHECK (app_is_admin())
    $f$, t);
  END LOOP;
END $$;
