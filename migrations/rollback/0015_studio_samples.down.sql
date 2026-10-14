-- ROLLBACK for 0015_studio_samples. Pieces learned from the studio are removed
-- from the voice's writing (the content items themselves are untouched).
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0015_studio_samples.down.sql
BEGIN;

ALTER TABLE voice_samples NO FORCE ROW LEVEL SECURITY;
DELETE FROM voice_samples WHERE source = 'studio';
ALTER TABLE voice_samples FORCE ROW LEVEL SECURITY;
ALTER TABLE voice_samples DROP CONSTRAINT voice_samples_source_check;
ALTER TABLE voice_samples ADD CONSTRAINT voice_samples_source_check
  CHECK (source IN ('paste', 'upload', 'export', 'url', 'voice_note', 'intake', 'connection'));
DELETE FROM _migrations WHERE id = '0015_studio_samples.sql';

COMMIT;
