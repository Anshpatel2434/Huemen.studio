-- ROLLBACK for 0020_context_version. Drops the per-call context version; the
-- calls themselves and every other column are untouched.
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0020_context_version.down.sql
BEGIN;
ALTER TABLE generation_logs DROP COLUMN IF EXISTS context_version;
DELETE FROM _migrations WHERE id = '0020_context_version.sql';
COMMIT;
