-- =============================================================================
-- ROLLBACK for 0006_voice_packs.
--
-- NOT run by `npm run db:migrate` (the runner only reads *.sql at the top of
-- migrations/). Run it by hand, in one transaction, only when going back to a
-- build that predates the Voice Pack.
--
-- What it does:
--   * copies each pack's carried-over values BACK onto the voice_guides row it
--     came from, so a workspace that edited its voice through the new UI does
--     not silently lose those edits on the way back
--   * drops voice_samples, voice_pack_versions, voice_packs and the
--     brand_profiles.voice_pack_id column
--   * forgets 0006 in _migrations so a later `db:migrate` re-applies it
--
-- What it CANNOT keep: anything the old schema has no room for — measured
-- mechanics, per-platform contexts, guardrails, version history and the corpus
-- beyond the sample posts. Take a backup first if any of that matters.
--
-- One asymmetry to expect: a person's brands SHARE one pack, so on the way back
-- each of that person's brands receives the pack's whole public corpus, not
-- only the posts it originally contributed. Rows are gained, never lost.
-- A workspace with no users at all never got a pack, and is untouched here.
--
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0006_voice_packs.down.sql
-- =============================================================================
BEGIN;

-- FORCE RLS filters the owner's own rows to nothing; lift it for the copy-back
-- and restore it before the tables are dropped.
ALTER TABLE brand_profiles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE voice_guides NO FORCE ROW LEVEL SECURITY;
ALTER TABLE voice_packs NO FORCE ROW LEVEL SECURITY;
ALTER TABLE voice_samples NO FORCE ROW LEVEL SECURITY;

-- Tone, reading level, do-words and never-words go back where they came from.
-- jsonb -> text[] for the two array columns; missing keys leave the old value.
UPDATE voice_guides vg
   SET tone_descriptors = COALESCE(vp.identity -> 'toneDescriptors' -> 'value', vg.tone_descriptors),
       reading_level    = COALESCE(vp.mechanics -> 'readingLevel' ->> 'value', vg.reading_level),
       do_words         = COALESCE(
                            (SELECT array_agg(x) FROM jsonb_array_elements_text(
                               vp.mechanics -> 'lexicon' -> 'value') AS x),
                            vg.do_words),
       dont_words       = COALESCE(
                            (SELECT array_agg(x) FROM jsonb_array_elements_text(
                               vp.red_pen -> 'neverList' -> 'value') AS x),
                            vg.dont_words)
  FROM brand_profiles bp
  JOIN voice_packs vp ON vp.id = bp.voice_pack_id
 WHERE vg.brand_profile_id = bp.id;

-- Public corpus pieces go back into sample_posts. Private ones (sent email,
-- chat) are NOT copied: the old table has no visibility flag, and the whole
-- point of that flag is that those pieces never travel.
UPDATE voice_guides vg
   SET sample_posts = COALESCE(s.posts, vg.sample_posts)
  FROM brand_profiles bp
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(x.body ORDER BY x.created_at) AS posts
      FROM voice_samples x
     WHERE x.pack_id = bp.voice_pack_id
       AND x.visibility = 'public'
       AND x.excluded = false
  ) s ON true
 WHERE vg.brand_profile_id = bp.id
   AND bp.voice_pack_id IS NOT NULL;

ALTER TABLE voice_guides FORCE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS voice_samples;
DROP TABLE IF EXISTS voice_pack_versions;
ALTER TABLE brand_profiles DROP COLUMN IF EXISTS voice_pack_id;
DROP TABLE IF EXISTS voice_packs;

ALTER TABLE brand_profiles FORCE ROW LEVEL SECURITY;

DELETE FROM _migrations WHERE id = '0006_voice_packs.sql';

COMMIT;
