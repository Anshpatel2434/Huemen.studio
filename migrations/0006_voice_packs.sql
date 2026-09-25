-- =============================================================================
-- 0006_voice_packs — the Voice Pack (client spec v2, files 01–07).
--
-- A voice belongs to a PERSON, not to a brand. One pack per user; a brand
-- points at one. That is the whole reason this migration exists: voice_guides
-- hung off brand_profiles, so the same human answering for two brands had two
-- unrelated voices. voice_guides stays in place for one release as a read
-- fallback and is dropped in 0007 once every tenant is migrated.
--
-- Isolation (INV-1) is unchanged: every new table carries tenant_id and gets
-- ENABLE + FORCE RLS + tenant_isolation. A Voice Pack is client CONTENT — the
-- most personal content in the system — so there is deliberately NO admin
-- bypass policy. Platform admins cannot read a user's writing.
--
-- The eight spec files map to columns as follows:
--   VOICE.md      -> voice_line + hard_rules
--   identity.md   -> identity
--   guardrails.md -> guardrails
--   mechanics.md  -> mechanics        (filled by the scan, every value evidenced)
--   contexts.md   -> contexts         (one key per platform, measured|inferred)
--   red-pen.md    -> red_pen
--   samples.md    -> voice_samples    (a row per piece, not a blob)
--   voice.json    -> voice_index      (the deterministic check index)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- voice_packs — one per person. `slug` is here so a second pack ("me" vs "my
-- company", spec question 5) is a row, not a migration. Default 'default'.
-- -----------------------------------------------------------------------------
CREATE TABLE voice_packs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug          text NOT NULL DEFAULT 'default',
  display_name  text,
  -- provisional: built from intake answers only, nothing measured yet.
  status        text NOT NULL DEFAULT 'provisional'
                  CHECK (status IN ('provisional', 'active', 'archived')),
  -- Bumped on every save. voice_pack_versions holds the snapshot for each.
  version       integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  voice_line    text,
  hard_rules    jsonb NOT NULL DEFAULT '[]'::jsonb,
  identity      jsonb NOT NULL DEFAULT '{}'::jsonb,
  guardrails    jsonb NOT NULL DEFAULT '[]'::jsonb,
  mechanics     jsonb NOT NULL DEFAULT '{}'::jsonb,
  contexts      jsonb NOT NULL DEFAULT '{}'::jsonb,
  red_pen       jsonb NOT NULL DEFAULT '{}'::jsonb,
  voice_index   jsonb NOT NULL DEFAULT '{}'::jsonb,
  corpus_stats  jsonb NOT NULL DEFAULT '{}'::jsonb,
  scanned_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, slug)
);
CREATE INDEX idx_voice_packs_tenant ON voice_packs(tenant_id);
CREATE INDEX idx_voice_packs_user ON voice_packs(user_id);
CREATE TRIGGER trg_voice_packs_updated BEFORE UPDATE ON voice_packs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- voice_pack_versions — every save keeps the whole previous pack. The spec
-- ("keep all versions, show a plain diff") needs the old state, not a log line.
-- -----------------------------------------------------------------------------
CREATE TABLE voice_pack_versions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pack_id    uuid NOT NULL REFERENCES voice_packs(id) ON DELETE CASCADE,
  version    integer NOT NULL CHECK (version >= 1),
  snapshot   jsonb NOT NULL,
  note       text,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pack_id, version)
);
CREATE INDEX idx_voice_pack_versions_tenant ON voice_pack_versions(tenant_id);
CREATE INDEX idx_voice_pack_versions_pack ON voice_pack_versions(pack_id, version DESC);

-- -----------------------------------------------------------------------------
-- voice_samples — the corpus, one row per piece.
--
-- `visibility` carries the private-source rule (spec question 12): a piece from
-- sent email or chat is 'private'. Private pieces feed MEASUREMENT only and are
-- never loaded as few-shot samples, so their facts cannot reach a draft. The
-- rule is enforced in code (lib/data/voice-pack) and stated here because the
-- column is the reason it can be enforced at all.
-- -----------------------------------------------------------------------------
CREATE TABLE voice_samples (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pack_id          uuid NOT NULL REFERENCES voice_packs(id) ON DELETE CASCADE,
  channel          text NOT NULL DEFAULT 'unknown',
  kind             text NOT NULL DEFAULT 'corpus'
                     CHECK (kind IN ('corpus', 'benchmark', 'anti_sample', 'unguarded', 'spoken')),
  source           text NOT NULL DEFAULT 'paste'
                     CHECK (source IN ('paste', 'upload', 'export', 'url', 'voice_note', 'intake', 'connection')),
  visibility       text NOT NULL DEFAULT 'public'
                     CHECK (visibility IN ('public', 'private')),
  body             text NOT NULL,
  word_count       integer NOT NULL DEFAULT 0,
  metrics          jsonb NOT NULL DEFAULT '{}'::jsonb,
  note             text,
  -- Suspected not-them (spec 06 §4). Never auto-deleted; the user confirms.
  excluded         boolean NOT NULL DEFAULT false,
  exclusion_reason text,
  published_at     date,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_voice_samples_tenant ON voice_samples(tenant_id);
CREATE INDEX idx_voice_samples_pack ON voice_samples(pack_id, kind);
CREATE INDEX idx_voice_samples_channel ON voice_samples(pack_id, channel);

-- -----------------------------------------------------------------------------
-- A brand points at the person whose voice it speaks in.
-- -----------------------------------------------------------------------------
ALTER TABLE brand_profiles
  ADD COLUMN voice_pack_id uuid REFERENCES voice_packs(id) ON DELETE SET NULL;
CREATE INDEX idx_brand_profiles_voice_pack ON brand_profiles(voice_pack_id);

-- -----------------------------------------------------------------------------
-- Backfill. Every existing voice_guide becomes a provisional pack for the
-- person the brand most likely belongs to: the project's creator, else the
-- workspace's first client user, else its first user.
--
-- Nothing is promoted to "measured". Values carried over are tagged
-- source=ask, confidence=inferred, exactly as they were: things the user typed,
-- not things we measured. Sample posts become corpus rows so the scan has
-- something to measure the day it runs.
--
-- The migrator is the table owner, which FORCE RLS filters to nothing, so FORCE
-- is lifted on brand_profiles for the backfill and restored in the same
-- transaction. The new tables are not forced until after this block.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  ALTER TABLE brand_profiles NO FORCE ROW LEVEL SECURITY;

  -- One pack per (tenant, person). Where a person has several brands, the most
  -- recently updated voice guide wins — it is the one they last looked at.
  INSERT INTO voice_packs (
    tenant_id, user_id, display_name, status, identity, mechanics, red_pen, voice_index
  )
  SELECT DISTINCT ON (t.tenant_id, t.user_id)
    t.tenant_id,
    t.user_id,
    u.email,
    'provisional',
    jsonb_build_object(
      'toneDescriptors',
      jsonb_build_object('value', COALESCE(t.tone_descriptors, '[]'::jsonb),
                         'source', 'ask', 'confidence', 'inferred')
    ),
    jsonb_build_object(
      'readingLevel',
      jsonb_build_object('value', COALESCE(t.reading_level, ''),
                         'source', 'ask', 'confidence', 'inferred'),
      'lexicon',
      jsonb_build_object('value', to_jsonb(COALESCE(t.do_words, '{}')),
                         'source', 'ask', 'confidence', 'inferred')
    ),
    jsonb_build_object(
      'neverList',
      jsonb_build_object('value', to_jsonb(COALESCE(t.dont_words, '{}')),
                         'source', 'ask', 'confidence', 'inferred')
    ),
    jsonb_build_object(
      'version', 1,
      'never_words', to_jsonb(COALESCE(t.dont_words, '{}')),
      'must_haves', '[]'::jsonb,
      'allowed_exceptions', '[]'::jsonb,
      'dials', '{}'::jsonb,
      'length_by_format', '{}'::jsonb,
      'signature_phrases', '[]'::jsonb,
      'signature_phrase_max_per_piece', 1,
      'punctuation', '{}'::jsonb,
      'sentence_length', '{}'::jsonb
    )
  FROM (
    SELECT bp.tenant_id, bp.id AS profile_id, vg.tone_descriptors, vg.do_words,
           vg.dont_words, vg.reading_level, vg.sample_posts, vg.updated_at,
           COALESCE(
             (SELECT p.created_by FROM projects p
               WHERE p.id = bp.project_id AND p.created_by IS NOT NULL),
             (SELECT u2.id FROM users u2
               WHERE u2.tenant_id = bp.tenant_id AND u2.role = 'client'
               ORDER BY u2.created_at LIMIT 1),
             (SELECT u2.id FROM users u2
               WHERE u2.tenant_id = bp.tenant_id
               ORDER BY u2.created_at LIMIT 1)
           ) AS user_id
      FROM brand_profiles bp
      JOIN voice_guides vg ON vg.brand_profile_id = bp.id
  ) t
  JOIN users u ON u.id = t.user_id
  ORDER BY t.tenant_id, t.user_id, t.updated_at DESC;

  -- Point every brand at its person's pack.
  UPDATE brand_profiles bp
     SET voice_pack_id = vp.id
    FROM voice_packs vp
   WHERE vp.tenant_id = bp.tenant_id
     AND bp.voice_pack_id IS NULL
     AND vp.user_id = COALESCE(
           (SELECT p.created_by FROM projects p
             WHERE p.id = bp.project_id AND p.created_by IS NOT NULL),
           (SELECT u2.id FROM users u2
             WHERE u2.tenant_id = bp.tenant_id AND u2.role = 'client'
             ORDER BY u2.created_at LIMIT 1),
           (SELECT u2.id FROM users u2
             WHERE u2.tenant_id = bp.tenant_id
             ORDER BY u2.created_at LIMIT 1)
         );

  -- Sample posts become corpus rows. They were pasted during intake, so they
  -- are public writing and may be used as few-shot samples.
  INSERT INTO voice_samples (tenant_id, pack_id, channel, kind, source, visibility, body, word_count)
  SELECT bp.tenant_id, bp.voice_pack_id, 'unknown', 'corpus', 'intake', 'public',
         s.body,
         array_length(regexp_split_to_array(btrim(s.body), '\s+'), 1)
    FROM brand_profiles bp
    JOIN voice_guides vg ON vg.brand_profile_id = bp.id
    CROSS JOIN LATERAL jsonb_array_elements_text(vg.sample_posts) AS s(body)
   WHERE bp.voice_pack_id IS NOT NULL
     AND btrim(s.body) <> '';

  -- The first version of every backfilled pack, so history starts at the
  -- migration rather than at whatever the user edits next.
  INSERT INTO voice_pack_versions (tenant_id, pack_id, version, snapshot, note)
  SELECT vp.tenant_id, vp.id, 1,
         to_jsonb(vp) - 'created_at' - 'updated_at',
         'Carried over from the brief voice step (0006). Nothing measured yet.'
    FROM voice_packs vp;

  ALTER TABLE brand_profiles FORCE ROW LEVEL SECURITY;
END $$;

-- Duplicate corpus rows are pointless: the same pasted post via two brands
-- teaches nothing twice. Enforced after the backfill so it never blocks it.
DELETE FROM voice_samples a
 USING voice_samples b
 WHERE a.pack_id = b.pack_id
   AND a.body = b.body
   AND a.ctid > b.ctid;

-- -----------------------------------------------------------------------------
-- RLS. Same shape as every other table (0002). No admin bypass: a Voice Pack is
-- the user's own writing.
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['voice_packs', 'voice_pack_versions', 'voice_samples'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = app_current_tenant())
        WITH CHECK (tenant_id = app_current_tenant())
    $f$, t);
  END LOOP;
END $$;

-- Explicit grants so re-runs on older databases are safe (as in 0003).
GRANT SELECT, INSERT, UPDATE, DELETE ON voice_packs TO huemen_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON voice_pack_versions TO huemen_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON voice_samples TO huemen_app;
