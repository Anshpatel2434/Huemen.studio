-- =============================================================================
-- ROLLBACK for 0009_onboarding_and_training. Run by hand, in one transaction:
--
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0009_onboarding_and_training.down.sql
--
-- Loses: onboarding progress, the F2 work mode, cached topic proposals, suspect
-- flags on pieces, per-project mode overrides, edit signals and pending coach
-- proposals. Nothing in the voice pack itself, the corpus, or any content.
-- =============================================================================
BEGIN;

DROP TABLE IF EXISTS voice_pack_proposals;
DROP TABLE IF EXISTS voice_edit_signals;
ALTER TABLE projects DROP COLUMN IF EXISTS mode;
ALTER TABLE voice_samples DROP COLUMN IF EXISTS suspect_reason;
ALTER TABLE voice_packs
  DROP COLUMN IF EXISTS topics_generated_at,
  DROP COLUMN IF EXISTS topic_suggestions,
  DROP COLUMN IF EXISTS work_mode,
  DROP COLUMN IF EXISTS onboarding;

DELETE FROM _migrations WHERE id = '0009_onboarding_and_training.sql';

COMMIT;
