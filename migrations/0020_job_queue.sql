-- =============================================================================
-- 0020_job_queue — the jobs table (0001) goes into use.
--
-- Work over ~10 seconds (a draft per pillar, the 90-day plan) is queued
-- instead of running inside the request (brief §05, TASKS P2-4). A worker
-- claims a job by setting status 'running' and a lease (locked_until). If the
-- function running it dies, the lease runs out and another worker takes the
-- job back, so nothing is stuck "running" forever.
--
-- `label` is what the person sees ("A draft from each pillar"); `kind` is what
-- the code runs. Finished jobs keep their progress (the pieces already made),
-- so a failure never loses work.
-- =============================================================================

ALTER TABLE jobs ADD COLUMN locked_until timestamptz;
ALTER TABLE jobs ADD COLUMN label text NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN finished_at timestamptz;

-- What a worker looks for: due queued jobs, and running jobs whose lease ran out.
CREATE INDEX idx_jobs_claim ON jobs (run_after) WHERE status IN ('queued', 'running');
-- What a page looks for: this workspace's latest job of a kind.
CREATE INDEX idx_jobs_tenant_kind ON jobs (tenant_id, kind, created_at DESC);
