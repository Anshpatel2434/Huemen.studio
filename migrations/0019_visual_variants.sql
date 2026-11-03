-- Keep visual variants (brief §4.3: "Regenerate, keep variants, download at
-- correct export dimensions per channel").
--
-- Regenerating a piece's visuals deleted the previous set before writing the
-- new one, so trying a second colour scheme destroyed the first and there was
-- no way back. The rows are now kept and marked instead: the current set is
-- the one with no `superseded_at`, and earlier sets stay readable so a person
-- can go back to one they preferred.

ALTER TABLE image_assets ADD COLUMN superseded_at timestamptz;

COMMENT ON COLUMN image_assets.superseded_at IS
  'When a regenerate replaced this set. NULL means it is the current set for its piece.';

-- The common read is "the current set for this piece", so index that.
CREATE INDEX idx_image_assets_current
  ON image_assets (content_item_id)
  WHERE superseded_at IS NULL;
