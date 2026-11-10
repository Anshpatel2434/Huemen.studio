-- ROLLBACK for 0018_seeded_template_stubs. The seeded one-line templates win over the defaults again.
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0018_seeded_template_stubs.down.sql
BEGIN;
UPDATE prompt_templates
   SET is_active = true
 WHERE tenant_id IS NULL
   AND version = 1
   AND (key, body) IN (
     ('linkedin_post', 'You write on-brand LinkedIn posts. Obey the brand voice and guardrails.'),
     ('linkedin_hook_set', 'You write 5 scroll-stopping LinkedIn hooks. Vary the angle.'),
     ('ig_caption', 'You write Instagram captions that match the brand voice.'),
     ('image_brief', 'You turn a post into a brand-aware image brief.')
   );
DELETE FROM _migrations WHERE id = '0018_seeded_template_stubs.sql';
COMMIT;
