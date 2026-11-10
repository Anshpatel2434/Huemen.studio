-- =============================================================================
-- 0019_calendar_slot_piece — a planned slot remembers the piece it started.
--
-- "Start" on a calendar slot creates a project (one piece) at Ideate, but the
-- slot kept no link to it: "Start" never went away and every click made
-- another project. The slot now points at the piece it started, and shows
-- "Open" instead. (calendar_entries.project_id is something else: which
-- calendar the slot belongs to, NULL for the workspace's, migration 0007.)
--
-- Tenant-consistent like 0010/0011: a slot can only point at a piece in its
-- own workspace, even though a foreign-key check ignores RLS. Deleting the
-- piece clears the link and nothing else, so the slot can be started again.
-- =============================================================================

ALTER TABLE projects ADD CONSTRAINT projects_id_tenant_key UNIQUE (id, tenant_id);

ALTER TABLE calendar_entries ADD COLUMN started_project_id uuid;
ALTER TABLE calendar_entries
  ADD CONSTRAINT calendar_entries_started_project_tenant_fkey
  FOREIGN KEY (started_project_id, tenant_id) REFERENCES projects (id, tenant_id)
  ON DELETE SET NULL (started_project_id);
CREATE INDEX idx_calendar_entries_started ON calendar_entries (started_project_id) WHERE started_project_id IS NOT NULL;
