-- ROLLBACK for 0001_core_schema: removes EVERYTHING. Run only after rolling
-- back every later migration (0002 onwards), newest first.
--
-- DATA LOSS, TOTAL: every workspace, person, brief, piece, log and setting is
-- dropped. This is the same as starting from an empty database; take a full
-- backup first (pg_dump) and be sure. The huemen_app role is left in place.
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0001_core_schema.down.sql
BEGIN;
DROP TABLE IF EXISTS
  jobs, admin_audit_log, tenant_usage_caps, generation_logs, offers,
  calendar_entries, ideas, image_assets, content_generations, content_items,
  prompt_templates, pillars, visual_identities, assets, voice_guides,
  brand_profiles, coach_assignments, users, tenants
  CASCADE;
DROP FUNCTION IF EXISTS tenants_set_self_tenant();
DROP FUNCTION IF EXISTS set_updated_at();
DELETE FROM _migrations WHERE id = '0001_core_schema.sql';
COMMIT;
