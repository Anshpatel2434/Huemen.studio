-- =============================================================================
-- 0016_visual_core — the rest of a brand's visual DNA (Layer 1, M9).
--
-- Beside palette and fonts, a visual identity now keeps a `core` object:
-- what each colour is for, layout grid, motifs, photo style, the website it
-- was read from (and the logo found there), and the reference designs picked
-- as "this is our look" (asset ids, kind reference_image). One jsonb column,
-- so the shape can grow without a migration per field. RLS is unchanged.
-- =============================================================================

ALTER TABLE visual_identities ADD COLUMN core jsonb NOT NULL DEFAULT '{}'::jsonb;
