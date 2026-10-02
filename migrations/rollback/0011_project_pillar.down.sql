-- ROLLBACK for 0011_project_pillar.
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0011_project_pillar.down.sql
BEGIN;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_pillar_tenant_fkey;
DROP INDEX IF EXISTS idx_projects_pillar;
ALTER TABLE projects DROP COLUMN IF EXISTS pillar_id;
ALTER TABLE pillars DROP CONSTRAINT IF EXISTS pillars_id_tenant_key;
DELETE FROM _migrations WHERE id = '0011_project_pillar.sql';

COMMIT;
