-- =============================================================================
-- 0021_pictures_and_comments — pictures from an image model, and comments
-- pinned on a spot of a visual.
--
-- image_assets gets a new kind, 'picture': a drawn image (ChatGPT Image, or
-- the stand-in) stored under the workspace's pictures/ prefix. Each visual
-- (single, quote_card, carousel_frame row) points at its picture in its design
-- params and says whether its heading is live text on top of the picture or
-- drawn into it. An area redraw makes a NEW picture row whose parent_id is the
-- one it was edited from, so every version stays for undo; is_current marks
-- the one in use. Tenant-consistent like 0010/0019: a version can only point
-- at a picture in its own workspace.
--
-- visual_comments is the history of "change this part": the box (fractions
-- of the visual, 0..1), what was asked, what it was routed to, and the
-- result. Tenant-isolated by RLS like every table.
-- =============================================================================

ALTER TABLE image_assets DROP CONSTRAINT image_assets_kind_check;
ALTER TABLE image_assets ADD CONSTRAINT image_assets_kind_check
  CHECK (kind IN ('single', 'carousel_frame', 'quote_card', 'announcement', 'picture'));

ALTER TABLE image_assets ADD CONSTRAINT image_assets_id_tenant_key UNIQUE (id, tenant_id);
ALTER TABLE image_assets ADD COLUMN parent_id uuid;
ALTER TABLE image_assets
  ADD CONSTRAINT image_assets_parent_tenant_fkey
  FOREIGN KEY (parent_id, tenant_id) REFERENCES image_assets (id, tenant_id)
  ON DELETE SET NULL (parent_id);
ALTER TABLE image_assets ADD COLUMN is_current boolean NOT NULL DEFAULT true;
CREATE INDEX idx_image_assets_parent ON image_assets (parent_id) WHERE parent_id IS NOT NULL;

CREATE TABLE visual_comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  content_item_id uuid NOT NULL,
  visual_id       uuid NOT NULL,              -- the image_assets row of the visual
  target          text NOT NULL
                    CHECK (target IN ('picture', 'headline', 'body', 'cta', 'logo', 'background')),
  box_x           real NOT NULL CHECK (box_x BETWEEN 0 AND 1),
  box_y           real NOT NULL CHECK (box_y BETWEEN 0 AND 1),
  box_w           real NOT NULL CHECK (box_w > 0 AND box_w <= 1),
  box_h           real NOT NULL CHECK (box_h > 0 AND box_h <= 1),
  note            text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 500),
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'working', 'applied', 'failed')),
  result          text,                        -- what changed, or why not, in plain words
  result_picture_id uuid,                      -- the new picture version, for picture edits
  job_id          uuid,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (visual_id, tenant_id) REFERENCES image_assets (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (result_picture_id, tenant_id) REFERENCES image_assets (id, tenant_id) ON DELETE SET NULL (result_picture_id)
);
CREATE INDEX idx_visual_comments_visual ON visual_comments (tenant_id, visual_id, created_at);
CREATE TRIGGER trg_visual_comments_updated BEFORE UPDATE ON visual_comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE visual_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE visual_comments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON visual_comments
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON visual_comments TO huemen_app;
