-- ROLLBACK for 0016_visual_core. Colour roles, grid, motifs and reference picks are dropped.
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0016_visual_core.down.sql
BEGIN;
ALTER TABLE visual_identities DROP COLUMN core;
DELETE FROM _migrations WHERE id = '0016_visual_core.sql';
COMMIT;
