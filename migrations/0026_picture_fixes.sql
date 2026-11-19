-- =============================================================================
-- 0026_picture_fixes — fixes from the 2026-11-19 picture audit.
--
-- visual_comments
--   frame         which frame of the visual a comment was put on (a carousel
--                 has several). The pin is drawn on that frame again after it
--                 is sent (PI-12), and a comment on a carousel slide's words
--                 rewrites only that slide (PI-13). Null for comments made
--                 before this column (they keep the old placing).
--   dismissed_at  "Clear" hides a comment instead of deleting it, so it can be
--                 brought back with Undo (PI-35). Rows are never deleted by Clear.
--
-- picture_locks (new)
--   One picture change per visual at a time. Until now a Postgres advisory
--   lock inside a transaction was held for the whole model call (30 to 300 s),
--   keeping a pooled connection idle in a transaction (PI-38). A lock is now a
--   short row with a holder and an expiry that the worker renews while it
--   works; no transaction stays open. A crashed worker's lock runs out.
--   Carries tenant_id with the same tenant_isolation policy as every table
--   (RLS, INV-1).
-- =============================================================================

ALTER TABLE visual_comments
  ADD COLUMN frame integer
    CONSTRAINT visual_comments_frame_check CHECK (frame IS NULL OR (frame >= 0 AND frame < 64)),
  ADD COLUMN dismissed_at timestamptz;

CREATE TABLE picture_locks (
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  content_item_id  uuid NOT NULL,
  artboard         text NOT NULL CONSTRAINT picture_locks_artboard_check CHECK (artboard IN ('post', 'quote', 'carousel')),
  holder           uuid NOT NULL,
  locked_until     timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (content_item_id, artboard),
  -- The lock's piece is in the lock's own workspace (0022's rule for every link).
  FOREIGN KEY (content_item_id, tenant_id) REFERENCES content_items (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX idx_picture_locks_tenant ON picture_locks (tenant_id);

ALTER TABLE picture_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE picture_locks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON picture_locks
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON picture_locks TO huemen_app;
