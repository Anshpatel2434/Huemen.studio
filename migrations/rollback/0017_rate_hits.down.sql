-- ROLLBACK for 0017_rate_hits. The short-window limits stop counting until it is applied again.
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0017_rate_hits.down.sql
BEGIN;
DROP TABLE rate_hits;
DELETE FROM _migrations WHERE id = '0017_rate_hits.sql';
COMMIT;
