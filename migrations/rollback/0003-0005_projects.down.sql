-- =============================================================================
-- ROLLBACK for 0003_projects, 0004_project_star, 0005_project_updated_at
-- (the `ui` branch's database changes). NOT run by `npm run db:migrate`: the
-- runner only reads *.sql at the top of migrations/, and this lives in
-- migrations/rollback/. Run it by hand, only when going back to `main`.
--
-- Prefer restoring the backup taken before migrating (docs/ui-branch.md §5).
-- Use this script only if there is no backup. What it does:
--   * drops the `projects` table and the project_id column on every child table
--   * KEEPS all rows: briefs, pillars, content and so on stay in their workspace.
--     If a workspace had several projects, their rows now all belong to the
--     workspace, as they did before projects existed.
--   * forgets 0003–0005 in _migrations so a later `db:migrate` can re-apply them
--
-- Run as the table owner (the migrator role), e.g.:
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0003-0005_projects.down.sql
-- It runs in one transaction, so it either fully applies or changes nothing.
-- =============================================================================
BEGIN;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'brand_profiles','assets','pillars','content_items','image_assets',
    'ideas','calendar_entries','offers'
  ] LOOP
    -- Drops its FK to projects and its idx_<table>_project index too.
    EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS project_id', t);
  END LOOP;
END $$;

DROP TABLE IF EXISTS projects;                          -- also drops its policy and trigger
DROP FUNCTION IF EXISTS projects_set_updated_at();

DELETE FROM _migrations WHERE id IN ('0003_projects.sql', '0004_project_star.sql', '0005_project_updated_at.sql');

COMMIT;
