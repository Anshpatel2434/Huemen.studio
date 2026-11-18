-- ROLLBACK for 0025_picture_tools. Markup and erase pins go back to plain
-- comments (their marks, brushed areas and picture areas are dropped); the
-- pictures they made stay.
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0025_picture_tools.down.sql
BEGIN;
ALTER TABLE visual_comments DROP CONSTRAINT IF EXISTS visual_comments_kind_target_check;
ALTER TABLE visual_comments DROP COLUMN IF EXISTS strokes;
ALTER TABLE visual_comments DROP COLUMN IF EXISTS area;
ALTER TABLE visual_comments DROP COLUMN IF EXISTS kind;
DELETE FROM _migrations WHERE id = '0025_picture_tools.sql';
COMMIT;
