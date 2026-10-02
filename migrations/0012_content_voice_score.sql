-- =============================================================================
-- 0012_content_voice_score — each piece remembers its latest voice check.
--
-- The Library filters pieces by band (on brand, drifting, off brand). Running
-- the check for every card on every page load would re-read the whole corpus
-- once per card, so the score is stored when it is computed: after a draft is
-- made or edited, and whenever the person runs the check.
--
-- It is a cache of a pure function of (draft, voice), never an input to one:
-- re-measuring the voice can make it stale, and the next check refreshes it.
-- Same table, same tenant_id, same RLS; no new policy needed.
-- =============================================================================

ALTER TABLE content_items ADD COLUMN voice_score smallint CHECK (voice_score BETWEEN 0 AND 100);
ALTER TABLE content_items ADD COLUMN voice_band text CHECK (voice_band IN ('on_brand', 'drifting', 'off_brand'));
ALTER TABLE content_items ADD COLUMN voice_checked_at timestamptz;

-- Storing a score is not an edit: keep updated_at when only the voice_* cache
-- changed, as 0005 does for starring a project.
CREATE OR REPLACE FUNCTION content_items_set_updated_at() RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(NEW) - 'voice_score' - 'voice_band' - 'voice_checked_at' - 'updated_at')
     = (to_jsonb(OLD) - 'voice_score' - 'voice_band' - 'voice_checked_at' - 'updated_at') THEN
    NEW.updated_at = OLD.updated_at;
  ELSE
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER trg_content_items_updated ON content_items;
CREATE TRIGGER trg_content_items_updated BEFORE UPDATE ON content_items
  FOR EACH ROW EXECUTE FUNCTION content_items_set_updated_at();
