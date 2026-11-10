-- ROLLBACK for 0019_calendar_slot_piece. Slots forget which piece they started.
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0019_calendar_slot_piece.down.sql
BEGIN;
ALTER TABLE calendar_entries DROP COLUMN started_project_id;
ALTER TABLE projects DROP CONSTRAINT projects_id_tenant_key;
DELETE FROM _migrations WHERE id = '0019_calendar_slot_piece.sql';
COMMIT;
