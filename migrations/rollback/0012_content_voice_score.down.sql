-- ROLLBACK for 0012_content_voice_score.
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0012_content_voice_score.down.sql
BEGIN;

DROP TRIGGER IF EXISTS trg_content_items_updated ON content_items;
CREATE TRIGGER trg_content_items_updated BEFORE UPDATE ON content_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP FUNCTION IF EXISTS content_items_set_updated_at();

ALTER TABLE content_items DROP COLUMN IF EXISTS voice_checked_at;
ALTER TABLE content_items DROP COLUMN IF EXISTS voice_band;
ALTER TABLE content_items DROP COLUMN IF EXISTS voice_score;
DELETE FROM _migrations WHERE id = '0012_content_voice_score.sql';

COMMIT;
