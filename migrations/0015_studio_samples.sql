-- =============================================================================
-- 0015_studio_samples — approved pieces can teach the voice they were written in.
--
-- A piece the voice's owner approves in the studio, and wrote or rewrote enough
-- to be theirs (lib/voice/learn), joins their writing as source 'studio'. The
-- note carries 'approved:<content_item_id>' so it can be traced and removed.
-- The table keeps its RLS; this only widens the allowed sources.
-- =============================================================================

ALTER TABLE voice_samples DROP CONSTRAINT voice_samples_source_check;
ALTER TABLE voice_samples ADD CONSTRAINT voice_samples_source_check
  CHECK (source IN ('paste', 'upload', 'export', 'url', 'voice_note', 'intake', 'connection', 'studio'));
