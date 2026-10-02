-- ROLLBACK for 0014_headshot_asset. Headshots become reference images.
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0014_headshot_asset.down.sql
BEGIN;

ALTER TABLE assets NO FORCE ROW LEVEL SECURITY;
UPDATE assets SET kind = 'reference_image' WHERE kind = 'headshot';
ALTER TABLE assets FORCE ROW LEVEL SECURITY;
ALTER TABLE assets DROP CONSTRAINT assets_kind_check;
ALTER TABLE assets ADD CONSTRAINT assets_kind_check
  CHECK (kind IN ('logo', 'font', 'reference_image', 'other'));
DELETE FROM _migrations WHERE id = '0014_headshot_asset.sql';

COMMIT;
