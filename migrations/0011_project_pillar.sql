-- =============================================================================
-- 0011_project_pillar — a piece remembers its pillar before it has any copy.
--
-- Ideate picks the pillar a piece sits under, but until 0011 the choice was
-- only written onto the piece's content_items, and at Ideate there are none
-- yet. So the pick was lost and the first draft landed under "No pillar".
-- The project now carries it; drafting reads it from there.
--
-- Tenant-consistent like 0010: the reference is (pillar_id, tenant_id), so a
-- project can only point at a pillar in its own workspace even though a
-- foreign-key check runs as the owner and ignores RLS. Deleting the pillar
-- clears the project's pick and nothing else (SET NULL on pillar_id only).
-- =============================================================================

ALTER TABLE pillars ADD CONSTRAINT pillars_id_tenant_key UNIQUE (id, tenant_id);

ALTER TABLE projects ADD COLUMN pillar_id uuid;
ALTER TABLE projects
  ADD CONSTRAINT projects_pillar_tenant_fkey
  FOREIGN KEY (pillar_id, tenant_id) REFERENCES pillars (id, tenant_id)
  ON DELETE SET NULL (pillar_id);

CREATE INDEX idx_projects_pillar ON projects (pillar_id);

-- Pieces that already have copy: take the pillar their content sits under.
ALTER TABLE projects NO FORCE ROW LEVEL SECURITY;
UPDATE projects p
   SET pillar_id = x.pillar_id
  FROM (
    SELECT DISTINCT ON (project_id) project_id, pillar_id, tenant_id
      FROM content_items
     WHERE pillar_id IS NOT NULL AND project_id IS NOT NULL
     ORDER BY project_id, created_at
  ) x
 WHERE x.project_id = p.id AND x.tenant_id = p.tenant_id;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
