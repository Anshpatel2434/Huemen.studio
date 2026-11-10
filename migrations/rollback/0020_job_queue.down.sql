-- ROLLBACK for 0020_job_queue. Jobs lose their lease, label and finish time.
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0020_job_queue.down.sql
BEGIN;
DROP INDEX IF EXISTS idx_jobs_tenant_kind;
DROP INDEX IF EXISTS idx_jobs_claim;
ALTER TABLE jobs DROP COLUMN finished_at;
ALTER TABLE jobs DROP COLUMN label;
ALTER TABLE jobs DROP COLUMN locked_until;
DELETE FROM _migrations WHERE id = '0020_job_queue.sql';
COMMIT;
