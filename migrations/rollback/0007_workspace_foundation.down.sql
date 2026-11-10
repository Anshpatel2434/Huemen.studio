-- ROLLBACK for 0007_workspace_foundation: SCHEMA ONLY. Run only after rolling
-- back every later migration (0008 onwards), newest first.
--
-- What this cannot undo: 0007 moved data. Every content item became its own
-- project, the old brand projects were archived, briefs, pillars, ideas,
-- offers, the calendar and uploads moved to workspace level, and duplicate
-- pillars were merged (the duplicates deleted). None of that is reversed here.
-- To get the pre-0007 data back, restore the database backup taken before
-- 0007 was applied. What this does: the stage set returns to
-- brief/pillars/content/visual, and the columns and index 0007 added go.
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0007_workspace_foundation.down.sql
BEGIN;
DROP INDEX IF EXISTS idx_brand_profiles_one_active_per_tenant;
ALTER TABLE projects DROP CONSTRAINT projects_stage_check;
ALTER TABLE projects NO FORCE ROW LEVEL SECURITY;
UPDATE projects SET stage = 'brief' WHERE stage = 'ideate';
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
ALTER TABLE projects ALTER COLUMN stage SET DEFAULT 'brief';
ALTER TABLE projects ADD CONSTRAINT projects_stage_check
  CHECK (stage IN ('brief', 'pillars', 'content', 'visual'));
DROP INDEX IF EXISTS idx_projects_idea;
ALTER TABLE projects DROP COLUMN angle;
ALTER TABLE projects DROP COLUMN idea_id;
ALTER TABLE projects DROP COLUMN channel;
ALTER TABLE projects DROP COLUMN format;
DELETE FROM _migrations WHERE id = '0007_workspace_foundation.sql';
COMMIT;
