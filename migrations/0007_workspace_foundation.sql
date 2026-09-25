-- =============================================================================
-- 0007_workspace_foundation — the brand moves up, the project moves down.
--
-- Client direction: a person's brief, voice, visual identity and pillars do not
-- change from one piece to the next, so they belong to ONBOARDING, once, at
-- workspace level. What changes every time is the piece itself. So:
--
--   before: a project = a brand.  Brief -> Pillars -> Content -> Visual
--   after:  a project = ONE OUTPUT. Ideate -> Content -> Visual
--
-- An Instagram post is a project. A LinkedIn post is another project. The
-- brand they are both written from sits above them, in the workspace.
--
-- What this migration does, in order:
--   1. projects gain a format/channel, the idea they came from, and the new
--      three-step stage set.
--   2. Every existing content_item becomes its own project, carrying its
--      visuals with it. The demo's six posts become six projects.
--   3. The old brand-shaped projects are ARCHIVED, not deleted. Their brief now
--      lives at workspace level, so the container has no job left.
--   4. brand_profiles, pillars, offers, ideas, calendar_entries and assets move
--      to workspace level (project_id = NULL). Where a workspace held several
--      brands, the most complete brief wins and the rest are kept as drafts.
--
-- Isolation (INV-1) is untouched: every row keeps its tenant_id and every
-- policy still keys on it. project_id was only ever a grouping inside a tenant.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A project is one piece of work.
-- -----------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN format  text;
ALTER TABLE projects ADD COLUMN channel text;
ALTER TABLE projects ADD COLUMN idea_id uuid REFERENCES ideas(id) ON DELETE SET NULL;
-- The angle chosen in Ideate: the take this particular piece argues.
ALTER TABLE projects ADD COLUMN angle   text;
CREATE INDEX idx_projects_idea ON projects(idea_id);

ALTER TABLE projects DROP CONSTRAINT projects_stage_check;
UPDATE projects SET stage = 'ideate' WHERE stage IN ('brief', 'pillars');
ALTER TABLE projects ALTER COLUMN stage SET DEFAULT 'ideate';
ALTER TABLE projects ADD CONSTRAINT projects_stage_check
  CHECK (stage IN ('ideate', 'content', 'visual'));

-- -----------------------------------------------------------------------------
-- 2–4. The data move. FORCE RLS filters the owner's own rows to nothing, so it
-- is lifted for the duration and restored in the same transaction (as in 0003).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  r record;
  pid uuid;
  moved integer := 0;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'projects','brand_profiles','assets','pillars','content_items','image_assets',
    'ideas','calendar_entries','offers','voice_packs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
  END LOOP;

  -- The projects that exist right now are brand containers, not pieces.
  CREATE TEMP TABLE legacy_projects ON COMMIT DROP AS SELECT id FROM projects;

  -- 2. Every piece becomes a project of its own.
  FOR r IN SELECT * FROM content_items ORDER BY created_at LOOP
    INSERT INTO projects (tenant_id, name, stage, format, channel, created_by, created_at)
    VALUES (
      r.tenant_id,
      left(COALESCE(NULLIF(btrim(r.hook), ''), NULLIF(btrim(r.topic), ''), 'Untitled piece'), 120),
      -- A piece that already has visuals has been through all three steps.
      CASE WHEN EXISTS (SELECT 1 FROM image_assets ia WHERE ia.content_item_id = r.id)
           THEN 'visual' ELSE 'content' END,
      r.format, r.channel, r.created_by, r.created_at
    )
    RETURNING id INTO pid;

    UPDATE content_items SET project_id = pid WHERE id = r.id;
    UPDATE image_assets  SET project_id = pid WHERE content_item_id = r.id;
    moved := moved + 1;
  END LOOP;
  RAISE NOTICE '0007: % content items became projects', moved;

  -- 3. The old containers are archived, never dropped: their names and their
  -- history are the only record of how the workspace was organised before.
  UPDATE projects SET status = 'archived'
   WHERE id IN (SELECT id FROM legacy_projects);

  -- 4a. One workspace, one brand. The most complete brief becomes the
  -- workspace foundation; any others stay as drafts, attached to nothing.
  WITH ranked AS (
    SELECT id, tenant_id,
           row_number() OVER (
             PARTITION BY tenant_id
             ORDER BY (status = 'active') DESC, completeness DESC, updated_at DESC
           ) AS rn
      FROM brand_profiles
  )
  UPDATE brand_profiles bp
     SET project_id = NULL,
         status = CASE WHEN ranked.rn = 1 THEN 'active' ELSE 'draft' END
    FROM ranked
   WHERE bp.id = ranked.id;

  -- 4b. Pillars, offers, ideas, the calendar and uploads belong to the
  -- workspace now. They were never really per-piece.
  FOREACH t IN ARRAY ARRAY['pillars','offers','ideas','calendar_entries','assets'] LOOP
    EXECUTE format('UPDATE %I SET project_id = NULL', t);
  END LOOP;

  -- 4c. The same pillar defined under three brands is one pillar. Keep the
  -- oldest, move every piece and idea onto it, then drop the duplicates.
  CREATE TEMP TABLE pillar_merge ON COMMIT DROP AS
    SELECT p.id AS dup_id, k.keep_id
      FROM pillars p
      JOIN (
        SELECT tenant_id, lower(btrim(name)) AS key,
               (array_agg(id ORDER BY created_at))[1] AS keep_id
          FROM pillars GROUP BY tenant_id, lower(btrim(name))
      ) k ON k.tenant_id = p.tenant_id AND k.key = lower(btrim(p.name))
     WHERE p.id <> k.keep_id;

  UPDATE content_items ci SET pillar_id = m.keep_id
    FROM pillar_merge m WHERE ci.pillar_id = m.dup_id;
  UPDATE ideas i SET pillar_id = m.keep_id
    FROM pillar_merge m WHERE i.pillar_id = m.dup_id;
  UPDATE calendar_entries e SET pillar_id = m.keep_id
    FROM pillar_merge m WHERE e.pillar_id = m.dup_id;
  DELETE FROM pillars WHERE id IN (SELECT dup_id FROM pillar_merge);

  -- 4d. Pillars pointed at whichever per-project brief created them. Repoint
  -- them at the one workspace brief so nothing dangles.
  UPDATE pillars p
     SET brand_profile_id = bp.id
    FROM brand_profiles bp
   WHERE bp.tenant_id = p.tenant_id
     AND bp.status = 'active'
     AND bp.project_id IS NULL
     AND p.brand_profile_id IS DISTINCT FROM bp.id;

  -- Keep the ordering contiguous after the merge.
  WITH ordered AS (
    SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY sort_order, created_at) - 1 AS n
      FROM pillars
  )
  UPDATE pillars p SET sort_order = ordered.n FROM ordered WHERE p.id = ordered.id;

  FOREACH t IN ARRAY ARRAY[
    'projects','brand_profiles','assets','pillars','content_items','image_assets',
    'ideas','calendar_entries','offers','voice_packs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- A workspace has at most one live brief. Enforced, because the whole point of
-- the change is that there is one brand to write from.
CREATE UNIQUE INDEX idx_brand_profiles_one_active_per_tenant
  ON brand_profiles (tenant_id)
  WHERE status = 'active' AND project_id IS NULL;
