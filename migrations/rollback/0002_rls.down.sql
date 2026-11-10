-- ROLLBACK for 0002_rls. Run only after rolling back every later migration
-- (0003 onwards), newest first: their policies use the functions dropped here.
--
-- WARNING: without these policies the database no longer keeps workspaces
-- apart (INV-1). Never serve requests from a database in this state; this
-- exists to rebuild the schema, not to run without isolation.
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0002_rls.down.sql
BEGIN;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants','users','coach_assignments','brand_profiles','voice_guides',
    'assets','visual_identities','pillars','prompt_templates','content_items',
    'content_generations','image_assets','ideas','calendar_entries','offers',
    'generation_logs','tenant_usage_caps','admin_audit_log','jobs'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS admin_all ON %I', t);
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
DROP POLICY IF EXISTS global_templates_readable ON prompt_templates;
DROP FUNCTION app_is_admin();
DROP FUNCTION app_current_tenant();
DELETE FROM _migrations WHERE id = '0002_rls.sql';
COMMIT;
