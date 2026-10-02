-- ROLLBACK for 0013_connections. Imported writing stays; it loses its link.
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0013_connections.down.sql
BEGIN;

DROP INDEX IF EXISTS idx_voice_samples_connection;
DROP INDEX IF EXISTS idx_voice_samples_external;
ALTER TABLE voice_samples DROP CONSTRAINT IF EXISTS voice_samples_connection_tenant_fkey;
ALTER TABLE voice_samples DROP COLUMN IF EXISTS external_id;
ALTER TABLE voice_samples DROP COLUMN IF EXISTS connection_id;
DROP TABLE IF EXISTS connections;
DELETE FROM _migrations WHERE id = '0013_connections.sql';

COMMIT;
