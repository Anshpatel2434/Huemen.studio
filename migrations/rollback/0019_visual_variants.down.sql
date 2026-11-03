-- ROLLBACK for 0019_visual_variants. Superseded sets become indistinguishable
-- from current ones, so a piece may show several sets at once until the next
-- regenerate. Delete them first if that matters:
--   DELETE FROM image_assets WHERE superseded_at IS NOT NULL;
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0019_visual_variants.down.sql
BEGIN;
DROP INDEX IF EXISTS idx_image_assets_current;
ALTER TABLE image_assets DROP COLUMN IF EXISTS superseded_at;
DELETE FROM _migrations WHERE id = '0019_visual_variants.sql';
COMMIT;
