-- =============================================================================
-- 0018_seeded_template_stubs — stop the seed's one-line prompt templates
-- shadowing the written defaults.
--
-- The seed used to insert global v1 rows for linkedin_post, linkedin_hook_set,
-- ig_caption and image_brief, each a single sentence. A stored row wins over
-- the default in code (lib/ai/templates resolveTemplate), so every seeded
-- database drafted from those stubs instead of the full templates. The seed no
-- longer writes them; this switches off any that exist. Only rows with the
-- exact seeded text are touched: an admin's own saved versions are left alone,
-- and nothing is deleted (drafts keep pointing at the version that wrote them).
-- =============================================================================

UPDATE prompt_templates
   SET is_active = false
 WHERE tenant_id IS NULL
   AND version = 1
   AND (key, body) IN (
     ('linkedin_post', 'You write on-brand LinkedIn posts. Obey the brand voice and guardrails.'),
     ('linkedin_hook_set', 'You write 5 scroll-stopping LinkedIn hooks. Vary the angle.'),
     ('ig_caption', 'You write Instagram captions that match the brand voice.'),
     ('image_brief', 'You turn a post into a brand-aware image brief.')
   );
