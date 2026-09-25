-- =============================================================================
-- 0008_brief_answers_on_brand — the onboarding answers belong to the brand.
--
-- The strategy questions ("what do you want to be known for", "what do you
-- believe that most people would argue with") are asked once, about the person,
-- and the pillars are generated from them. Under 0007 they are onboarding, not
-- per-piece, so they move from projects.brief_answers to the workspace brief.
--
-- projects.brief_answers is left in place and unused for one release: the old
-- rows are the only copy, and this migration reads them.
-- =============================================================================

ALTER TABLE brand_profiles
  ADD COLUMN brief_answers jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  ALTER TABLE brand_profiles NO FORCE ROW LEVEL SECURITY;

  -- Carry over the richest set of answers each workspace gave.
  UPDATE brand_profiles bp
     SET brief_answers = best.brief_answers
    FROM (
      SELECT DISTINCT ON (tenant_id) tenant_id, brief_answers
        FROM projects
       WHERE jsonb_array_length(COALESCE(brief_answers, '[]'::jsonb)) > 0
       ORDER BY tenant_id, jsonb_array_length(brief_answers) DESC, updated_at DESC
    ) best
   WHERE bp.tenant_id = best.tenant_id
     AND bp.project_id IS NULL
     AND bp.status = 'active';

  ALTER TABLE brand_profiles FORCE ROW LEVEL SECURITY;
END $$;
