-- =============================================================================
-- 0003_projects — a workspace (tenant) holds many PROJECTS. Each project runs
-- the stepwise pipeline Brief → Pillars → Content → Visual and owns its own
-- brief, pillars, content, ideas, calendar, offers, assets and visuals.
--
-- Isolation (INV-1) is unchanged: projects carry tenant_id and get the same
-- ENABLE + FORCE RLS + tenant_isolation policy. Projects are client CONTENT, so
-- there is deliberately NO admin_all bypass. project_id on child rows is an
-- application-level grouping INSIDE a tenant; RLS still keys on tenant_id.
-- =============================================================================

CREATE TABLE projects (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           text NOT NULL,
  description    text,
  -- Furthest unlocked step. Steps unlock in order; never skipped (see UI gates).
  stage          text NOT NULL DEFAULT 'brief'
                   CHECK (stage IN ('brief', 'pillars', 'content', 'visual')),
  -- Answers to the brief's follow-up questions: [{key, question, answer, target}].
  brief_answers  jsonb NOT NULL DEFAULT '[]'::jsonb,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_projects_tenant ON projects(tenant_id, updated_at DESC);
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON projects
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- project_id on every project-owned table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'brand_profiles','assets','pillars','content_items','image_assets',
    'ideas','calendar_entries','offers'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN project_id uuid REFERENCES projects(id) ON DELETE CASCADE', t);
    EXECUTE format('CREATE INDEX idx_%s_project ON %I(project_id)', t, t);
  END LOOP;
END $$;

-- Backfill: every tenant that already has project-owned rows gets one
-- "Personal brand" project and its rows are moved into it. The migrator is the
-- table owner, which FORCE RLS would otherwise filter to nothing, so FORCE is
-- lifted for the backfill only and restored in the same transaction.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'projects','brand_profiles','assets','pillars','content_items','image_assets',
    'ideas','calendar_entries','offers'
  ] LOOP
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
  END LOOP;

  INSERT INTO projects (tenant_id, name, stage)
  SELECT DISTINCT x.tenant_id, 'Personal brand',
         CASE
           WHEN EXISTS (SELECT 1 FROM content_items c WHERE c.tenant_id = x.tenant_id) THEN 'visual'
           WHEN EXISTS (SELECT 1 FROM pillars p WHERE p.tenant_id = x.tenant_id) THEN 'content'
           ELSE 'brief'
         END
    FROM (
      SELECT tenant_id FROM brand_profiles UNION SELECT tenant_id FROM pillars
      UNION SELECT tenant_id FROM content_items UNION SELECT tenant_id FROM ideas
      UNION SELECT tenant_id FROM calendar_entries UNION SELECT tenant_id FROM offers
      UNION SELECT tenant_id FROM assets
    ) x;

  FOREACH t IN ARRAY ARRAY[
    'brand_profiles','assets','pillars','content_items','image_assets',
    'ideas','calendar_entries','offers'
  ] LOOP
    EXECUTE format(
      'UPDATE %I r SET project_id = p.id FROM projects p WHERE p.tenant_id = r.tenant_id AND r.project_id IS NULL', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'projects','brand_profiles','assets','pillars','content_items','image_assets',
    'ideas','calendar_entries','offers'
  ] LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- The runtime role gets CRUD on the new table via default privileges (0000
-- bootstrap); grant explicitly too so re-runs on older databases are safe.
GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO huemen_app;
