-- =============================================================================
-- 0014_headshot_asset — a person's headshot, alongside their logo.
--
-- Onboarding step 3 now asks for a logo and a headshot: visuals need both, and
-- the palette can be suggested from the logo. A headshot is a person's face,
-- so it gets its own kind rather than hiding in 'reference_image': it can be
-- found, listed and removed on its own.
-- =============================================================================

ALTER TABLE assets DROP CONSTRAINT assets_kind_check;
ALTER TABLE assets ADD CONSTRAINT assets_kind_check
  CHECK (kind IN ('logo', 'font', 'reference_image', 'headshot', 'other'));
