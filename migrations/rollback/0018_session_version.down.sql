-- ROLLBACK for 0018_session_version. Live cookies stop being checked against a
-- version (they still expire on their own `exp`), so a role change no longer
-- retires a session already in a browser.
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0018_session_version.down.sql
BEGIN;
ALTER TABLE users DROP COLUMN IF EXISTS session_version;
DELETE FROM _migrations WHERE id = '0018_session_version.sql';
COMMIT;
