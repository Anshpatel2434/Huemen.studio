-- ROLLBACK for 0026_picture_fixes. Comments lose their frame (pins go back to
-- the first frame with that part) and cleared comments show again (nothing was
-- deleted, so nothing is lost). Picture locks go; a change running at that
-- moment finishes without one.
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0026_picture_fixes.down.sql
BEGIN;
DROP TABLE IF EXISTS picture_locks;
ALTER TABLE visual_comments DROP CONSTRAINT IF EXISTS visual_comments_frame_check;
ALTER TABLE visual_comments DROP COLUMN IF EXISTS frame;
ALTER TABLE visual_comments DROP COLUMN IF EXISTS dismissed_at;
DELETE FROM _migrations WHERE id = '0026_picture_fixes.sql';
COMMIT;
