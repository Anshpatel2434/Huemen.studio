-- =============================================================================
-- 0009_onboarding_and_training — the state behind build steps 4 to 8.
--
--   voice_packs.onboarding        where the person is in the four-step stepper,
--                                 the sources they picked (G1), the platforms we
--                                 write for (F1), and which questions they have
--                                 answered. Core and Deep answers themselves
--                                 land in the pack's own fields.
--   voice_packs.work_mode         F2: ghostwrite | cowrite | check. The Create
--                                 default; a project may override it.
--   voice_packs.topic_suggestions cached proposals for an empty Create (§12),
--                                 so a page view never pays for a model call.
--   voice_samples.suspect_reason  a piece the scan thinks reads unlike the rest
--                                 (H3). Never auto-excluded; the person decides.
--   projects.mode                 per-piece override of work_mode.
--   voice_edit_signals            what people keep changing in drafts. Four of
--                                 the same change becomes a proposal card.
--   voice_pack_proposals          a coach's change to someone else's voice,
--                                 waiting for the owner.
--
-- Every new table carries tenant_id with ENABLE + FORCE RLS and no admin bypass
-- (INV-1): it is all derived from a person's own writing.
-- =============================================================================

ALTER TABLE voice_packs
  ADD COLUMN onboarding jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN work_mode text NOT NULL DEFAULT 'ghostwrite'
    CHECK (work_mode IN ('ghostwrite', 'cowrite', 'check')),
  ADD COLUMN topic_suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN topics_generated_at timestamptz;

ALTER TABLE voice_samples ADD COLUMN suspect_reason text;

ALTER TABLE projects ADD COLUMN mode text
  CHECK (mode IS NULL OR mode IN ('ghostwrite', 'cowrite', 'check'));

CREATE TABLE voice_edit_signals (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pack_id    uuid NOT NULL REFERENCES voice_packs(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('removed_word')),
  value      text NOT NULL,
  count      integer NOT NULL DEFAULT 0,
  -- counting until the threshold; then a proposal the person accepts or drops.
  status     text NOT NULL DEFAULT 'counting'
               CHECK (status IN ('counting', 'proposed', 'accepted', 'dismissed')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pack_id, kind, value)
);
CREATE INDEX idx_voice_edit_signals_tenant ON voice_edit_signals(tenant_id);
CREATE INDEX idx_voice_edit_signals_pack ON voice_edit_signals(pack_id, status);

CREATE TABLE voice_pack_proposals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pack_id     uuid NOT NULL REFERENCES voice_packs(id) ON DELETE CASCADE,
  patch       jsonb NOT NULL,
  note        text,
  proposed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
CREATE INDEX idx_voice_pack_proposals_tenant ON voice_pack_proposals(tenant_id);
CREATE INDEX idx_voice_pack_proposals_pack ON voice_pack_proposals(pack_id, status);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['voice_edit_signals', 'voice_pack_proposals'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = app_current_tenant())
        WITH CHECK (tenant_id = app_current_tenant())
    $f$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON voice_edit_signals TO huemen_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON voice_pack_proposals TO huemen_app;

-- Packs that already have measured writing have, in effect, finished step 1.
-- Everyone else starts at the beginning of the stepper.
DO $$
BEGIN
  ALTER TABLE voice_packs NO FORCE ROW LEVEL SECURITY;
  UPDATE voice_packs
     SET onboarding = jsonb_build_object('step', CASE WHEN scanned_at IS NOT NULL THEN 2 ELSE 1 END);
  ALTER TABLE voice_packs FORCE ROW LEVEL SECURITY;
END $$;
