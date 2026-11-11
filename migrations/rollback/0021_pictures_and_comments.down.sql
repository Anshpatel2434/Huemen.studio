-- ROLLBACK for 0021_pictures_and_comments. Comments and picture versions go;
-- pictures themselves are removed (their files stay in storage until swept).
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0021_pictures_and_comments.down.sql
BEGIN;
DROP TABLE visual_comments;
DELETE FROM image_assets WHERE kind = 'picture';
DROP INDEX IF EXISTS idx_image_assets_parent;
ALTER TABLE image_assets DROP COLUMN is_current;
ALTER TABLE image_assets DROP CONSTRAINT image_assets_parent_tenant_fkey;
ALTER TABLE image_assets DROP COLUMN parent_id;
ALTER TABLE image_assets DROP CONSTRAINT image_assets_id_tenant_key;
ALTER TABLE image_assets DROP CONSTRAINT image_assets_kind_check;
ALTER TABLE image_assets ADD CONSTRAINT image_assets_kind_check
  CHECK (kind IN ('single', 'carousel_frame', 'quote_card', 'announcement'));
DELETE FROM _migrations WHERE id = '0021_pictures_and_comments.sql';
COMMIT;
