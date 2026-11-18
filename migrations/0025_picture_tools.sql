-- =============================================================================
-- 0025_picture_tools — the picture tools on the Visual board: several pins in
-- one Send, Markup and Erase.
--
-- visual_comments already holds "change this part" (0021). A pin on a picture
-- now says HOW it asks:
--
--   kind     'comment'  a box and a note (as before)
--            'markup'   marks drawn on the picture (a circle, an arrow) and a note
--            'erase'    a brushed area to remove
--   area     the box on the PICTURE itself (fractions 0..1). The stored box_*
--            columns place the pin on the visual's frame; the picture is
--            cropped to its slot, so the two differ. Until now the area lived
--            only in the job's payload, so Try again could redraw the wrong box.
--   strokes  the drawn marks or the brushed area: [{ "w": 0.06, "pts": [[x, y], ...] }]
--            in fractions of the picture. The application caps it at 12
--            strokes of 64 points; the size check here is the backstop.
--
-- No new table and no policy change: the columns sit behind the table's
-- existing tenant_isolation policy (RLS, INV-1).
-- =============================================================================

ALTER TABLE visual_comments
  ADD COLUMN kind text NOT NULL DEFAULT 'comment'
    CONSTRAINT visual_comments_kind_check CHECK (kind IN ('comment', 'markup', 'erase')),
  ADD COLUMN area jsonb
    CONSTRAINT visual_comments_area_check CHECK (area IS NULL OR jsonb_typeof(area) = 'object'),
  ADD COLUMN strokes jsonb
    CONSTRAINT visual_comments_strokes_check
      CHECK (strokes IS NULL OR (jsonb_typeof(strokes) = 'array' AND octet_length(strokes::text) <= 32768));

-- Marks and brushed areas are things done to a picture, never to the text or the design.
ALTER TABLE visual_comments
  ADD CONSTRAINT visual_comments_kind_target_check CHECK (kind = 'comment' OR target = 'picture');
