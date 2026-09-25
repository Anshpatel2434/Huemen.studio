/**
 * Voice Pack data access (client spec v2).
 *
 * A voice belongs to a PERSON. A project reaches its pack through the brand
 * profile it owns; if that link is missing (an older project, or a brand made
 * before 0006) the session user's own pack is used and the link is written, so
 * the same human never ends up with two voices.
 *
 * Two rules from the spec are enforced HERE rather than trusted to callers,
 * because this is the only place they can be enforced:
 *
 *   1. Private sources teach rhythm, never facts. A piece from sent email or
 *      chat is measured like any other, but `fewShotSamples` will not return
 *      it, so its content cannot reach a draft.
 *   2. Every save keeps the previous version. There is no update path that
 *      quietly loses what the pack said before.
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession, type SessionScope } from "@/db/session";
import type { WorkspaceScope } from "./projects";
import { measureCorpus } from "@/lib/voice/measure";
import {
  emptyIndex,
  MEASURED_CONTEXT_MINIMUM,
  type CorpusStats,
  type Guardrail,
  type Identity,
  type Mechanics,
  type RedPen,
  type SampleKind,
  type SampleSource,
  type VoiceContext,
  type VoiceIndex,
  type VoicePack,
  type VoiceSample,
} from "@/lib/voice/types";

/** How many real pieces go into any one prompt (our answer to question 15). */
export const FEW_SHOT_LIMIT = 8;

interface PackRow {
  id: string; user_id: string; slug: string; display_name: string | null;
  status: VoicePack["status"]; version: number; voice_line: string | null;
  hard_rules: string[]; identity: Identity; guardrails: Guardrail[];
  mechanics: Mechanics; contexts: Record<string, VoiceContext>; red_pen: RedPen;
  voice_index: Partial<VoiceIndex>; corpus_stats: Partial<CorpusStats>;
  scanned_at: Date | null;
}

const EMPTY_STATS: CorpusStats = { pieces: 0, words: 0, sentences: 0, channels: [] };

function toPack(r: PackRow): VoicePack {
  return {
    id: r.id,
    userId: r.user_id,
    slug: r.slug,
    displayName: r.display_name ?? "",
    status: r.status,
    version: r.version,
    voiceLine: r.voice_line ?? "",
    hardRules: r.hard_rules ?? [],
    identity: r.identity ?? {},
    guardrails: r.guardrails ?? [],
    mechanics: r.mechanics ?? {},
    contexts: r.contexts ?? {},
    redPen: r.red_pen ?? {},
    index: { ...emptyIndex(), ...(r.voice_index ?? {}) },
    corpusStats: { ...EMPTY_STATS, ...(r.corpus_stats ?? {}) },
    scannedAt: r.scanned_at ? r.scanned_at.toISOString() : null,
  };
}

const PACK_COLUMNS = [
  "id", "user_id", "slug", "display_name", "status", "version", "voice_line",
  "hard_rules", "identity", "guardrails", "mechanics", "contexts", "red_pen",
  "voice_index", "corpus_stats", "scanned_at",
] as const;

const COLS = PACK_COLUMNS.join(", ");
const COLS_VP = PACK_COLUMNS.map((c) => `vp.${c}`).join(", ");
const SELECT = `SELECT ${COLS} FROM voice_packs`;

/**
 * The pack for one person, created on first use. A person with no pack is a
 * person we have never written for, so a provisional empty one is the honest
 * starting state — not an error.
 */
export async function getOrCreatePack(
  scope: SessionScope & { tenantId: string },
  userId: string,
  slug = "default",
): Promise<VoicePack> {
  return withTenantSession(scope, async (c) => {
    const found = (
      await c.query<PackRow>(`${SELECT} WHERE user_id=$1 AND slug=$2`, [userId, slug])
    ).rows[0];
    if (found) return toPack(found);

    const email = (
      await c.query<{ email: string }>("SELECT email FROM users WHERE id=$1", [userId])
    ).rows[0]?.email;
    const created = (
      await c.query<PackRow>(
        `INSERT INTO voice_packs (tenant_id, user_id, slug, display_name, voice_index)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id, user_id, slug) DO NOTHING
         RETURNING ${COLS}`,
        [scope.tenantId, userId, slug, email ?? null, JSON.stringify(emptyIndex())],
      )
    ).rows[0];
    if (created) return toPack(created);
    // Lost a concurrent create (two server components load the pack in parallel
    // on first visit) — the row now exists, so read it back.
    const existing = (
      await c.query<PackRow>(`${SELECT} WHERE user_id=$1 AND slug=$2`, [userId, slug])
    ).rows[0];
    return toPack(existing);
  });
}

/**
 * The pack this workspace writes in — the voice of the person whose brand it
 * is. Falls back to the session user's pack and repairs the link, so a
 * workspace set up before the Voice Pack existed picks up its owner's voice the
 * first time someone opens it.
 */
export async function loadPackForWorkspace(scope: WorkspaceScope): Promise<VoicePack | null> {
  const linked = await withTenantSession(scope, async (c) => {
    const row = (
      await c.query<PackRow>(
        `SELECT ${COLS_VP}
           FROM voice_packs vp
           JOIN brand_profiles bp ON bp.voice_pack_id = vp.id
          WHERE bp.project_id IS NULL
          ORDER BY bp.status='active' DESC, bp.updated_at DESC
          LIMIT 1`,
      )
    ).rows[0];
    return row ? toPack(row) : null;
  });
  if (linked) return linked;
  if (!scope.userId) return null;

  const pack = await getOrCreatePack(scope, scope.userId);
  await linkBrandToPack(scope, pack.id);
  await adoptLegacyVoiceGuide(scope, pack.id);
  return pack;
}

/**
 * Pull a project's old voice_guide into a brand-new pack.
 *
 * The pre-workshop questionnaire is public and runs before anyone has an
 * account, so it cannot write to a pack — a pack belongs to a person and there
 * is no person yet. It still writes a voice_guide, and this adopts those
 * answers the first time the client opens the project.
 *
 * Only ever runs on an UNTOUCHED pack: nothing scanned, no corpus, no
 * never-list. So a piece the user later deletes does not quietly come back.
 */
async function adoptLegacyVoiceGuide(scope: WorkspaceScope, packId: string): Promise<void> {
  await withTenantSession(scope, async (c) => {
    const fresh = (
      await c.query<{ id: string }>(
        `SELECT vp.id FROM voice_packs vp
          WHERE vp.id = $1
            AND vp.scanned_at IS NULL
            AND COALESCE(jsonb_array_length(vp.voice_index -> 'neverWords'), 0) = 0
            AND NOT EXISTS (SELECT 1 FROM voice_samples s WHERE s.pack_id = vp.id)`,
        [packId],
      )
    ).rows[0];
    if (!fresh) return;

    const vg = (
      await c.query<{ tone_descriptors: string[]; dont_words: string[]; do_words: string[]; reading_level: string | null; sample_posts: string[] }>(
        `SELECT vg.tone_descriptors, vg.dont_words, vg.do_words, vg.reading_level, vg.sample_posts
           FROM voice_guides vg
           JOIN brand_profiles bp ON bp.id = vg.brand_profile_id
          WHERE bp.project_id IS NULL
          ORDER BY vg.updated_at DESC LIMIT 1`,
      )
    ).rows[0];
    if (!vg) return;

    const posts = (vg.sample_posts ?? []).map((p) => String(p).trim()).filter(Boolean);
    for (const body of posts) {
      await c.query(
        `INSERT INTO voice_samples (tenant_id, pack_id, channel, kind, source, visibility, body, word_count)
         SELECT $1,$2,'unknown','corpus','intake','public',$3,$4
          WHERE NOT EXISTS (SELECT 1 FROM voice_samples WHERE pack_id=$2 AND body=$3)`,
        [scope.tenantId, packId, body, body.split(/\s+/).filter(Boolean).length],
      );
    }

    const never = vg.dont_words ?? [];
    await c.query(
      `UPDATE voice_packs
          SET identity = identity || jsonb_build_object('toneDescriptors',
                jsonb_build_object('value', to_jsonb($1::text[]), 'source', 'ask', 'confidence', 'inferred')),
              mechanics = mechanics || jsonb_build_object(
                'lexicon', jsonb_build_object('value', to_jsonb($2::text[]), 'source', 'ask', 'confidence', 'inferred'),
                'readingLevel', jsonb_build_object('value', COALESCE($3::text, ''), 'source', 'ask', 'confidence', 'inferred')),
              red_pen = red_pen || jsonb_build_object('neverList',
                jsonb_build_object('value', to_jsonb($4::text[]), 'source', 'ask', 'confidence', 'inferred')),
              voice_index = jsonb_set(voice_index, '{neverWords}', to_jsonb($4::text[]))
        WHERE id = $5`,
      [vg.tone_descriptors ?? [], vg.do_words ?? [], vg.reading_level, never, packId],
    );
  });
}

export async function linkBrandToPack(scope: WorkspaceScope, packId: string): Promise<void> {
  await withTenantSession(scope, (c) =>
    c.query(
      `UPDATE brand_profiles SET voice_pack_id=$1
        WHERE project_id IS NULL AND voice_pack_id IS DISTINCT FROM $1`,
      [packId],
    ),
  );
}

// ---- saving -----------------------------------------------------------------

export type PackPatch = Partial<
  Pick<VoicePack, "voiceLine" | "hardRules" | "identity" | "guardrails" | "mechanics" | "contexts" | "redPen" | "index" | "status" | "displayName">
>;

const COLUMN: Record<keyof PackPatch, string> = {
  voiceLine: "voice_line", hardRules: "hard_rules", identity: "identity",
  guardrails: "guardrails", mechanics: "mechanics", contexts: "contexts",
  redPen: "red_pen", index: "voice_index", status: "status", displayName: "display_name",
};
const JSON_COLUMNS = new Set(["hard_rules", "identity", "guardrails", "mechanics", "contexts", "red_pen", "voice_index"]);

/**
 * Save a change and keep what it replaced. The snapshot is written BEFORE the
 * update, inside the same transaction, so history can never be one save behind.
 */
export async function savePack(
  scope: SessionScope & { tenantId: string },
  packId: string,
  patch: PackPatch,
  note?: string,
): Promise<VoicePack | null> {
  const entries = (Object.keys(patch) as (keyof PackPatch)[]).filter((k) => patch[k] !== undefined);
  if (!entries.length) return null;

  return withTenantSession(scope, async (c) => {
    const current = (await c.query<PackRow>(`${SELECT} WHERE id=$1`, [packId])).rows[0];
    if (!current) return null;

    await c.query(
      `INSERT INTO voice_pack_versions (tenant_id, pack_id, version, snapshot, note, changed_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (pack_id, version) DO NOTHING`,
      [scope.tenantId, packId, current.version, JSON.stringify(toPack(current)), note ?? null, scope.userId],
    );

    const sets = entries.map((k, i) => `${COLUMN[k]}=$${i + 1}`);
    const values = entries.map((k) => {
      const col = COLUMN[k];
      const v = patch[k];
      return JSON_COLUMNS.has(col) ? JSON.stringify(v) : v;
    });
    const updated = (
      await c.query<PackRow>(
        `UPDATE voice_packs SET ${sets.join(", ")}, version = version + 1
          WHERE id=$${entries.length + 1}
        RETURNING ${COLS}`,
        [...values, packId],
      )
    ).rows[0];
    return updated ? toPack(updated) : null;
  });
}

export interface PackVersion {
  version: number;
  note: string | null;
  createdAt: string;
  changedByEmail: string | null;
  snapshot: VoicePack;
}

export async function listVersions(
  scope: SessionScope & { tenantId: string },
  packId: string,
  limit = 20,
): Promise<PackVersion[]> {
  return withTenantSession(scope, async (c) => {
    const rows = (
      await c.query<{ version: number; note: string | null; created_at: Date; email: string | null; snapshot: VoicePack }>(
        `SELECT v.version, v.note, v.created_at, u.email, v.snapshot
           FROM voice_pack_versions v
           LEFT JOIN users u ON u.id = v.changed_by
          WHERE v.pack_id=$1 ORDER BY v.version DESC LIMIT $2`,
        [packId, limit],
      )
    ).rows;
    return rows.map((r) => ({
      version: r.version,
      note: r.note,
      createdAt: r.created_at.toISOString(),
      changedByEmail: r.email,
      snapshot: r.snapshot,
    }));
  });
}

// ---- the corpus -------------------------------------------------------------

export interface NewSample {
  body: string;
  channel?: string;
  kind?: SampleKind;
  source?: SampleSource;
  visibility?: "public" | "private";
  publishedAt?: string | null;
  note?: string;
}

const sampleRow = (r: Record<string, unknown>): VoiceSample => ({
  id: r.id as string,
  channel: r.channel as string,
  kind: r.kind as SampleKind,
  source: r.source as SampleSource,
  visibility: r.visibility as "public" | "private",
  body: r.body as string,
  wordCount: r.word_count as number,
  note: (r.note as string) ?? undefined,
  excluded: r.excluded as boolean,
  exclusionReason: (r.exclusion_reason as string) ?? undefined,
  publishedAt: r.published_at ? (r.published_at as Date).toISOString().slice(0, 10) : undefined,
});

const SAMPLE_COLS = `id, channel, kind, source, visibility, body, word_count, note, excluded, exclusion_reason, published_at`;

export async function addSamples(
  scope: SessionScope & { tenantId: string },
  packId: string,
  samples: NewSample[],
): Promise<number> {
  const clean = samples.filter((s) => s.body.trim().length > 0);
  if (!clean.length) return 0;
  return withTenantSession(scope, async (c) => {
    let added = 0;
    for (const s of clean) {
      const body = s.body.trim();
      const res = await c.query(
        `INSERT INTO voice_samples
           (tenant_id, pack_id, channel, kind, source, visibility, body, word_count, note, published_at)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
          WHERE NOT EXISTS (SELECT 1 FROM voice_samples WHERE pack_id=$2 AND body=$7)`,
        [
          scope.tenantId, packId, s.channel ?? "unknown", s.kind ?? "corpus",
          s.source ?? "paste", s.visibility ?? "public", body,
          body.split(/\s+/).filter(Boolean).length, s.note ?? null, s.publishedAt ?? null,
        ],
      );
      added += res.rowCount ?? 0;
    }
    return added;
  });
}

export async function listSamples(
  scope: SessionScope & { tenantId: string },
  packId: string,
  opts: { includeExcluded?: boolean; channel?: string } = {},
): Promise<VoiceSample[]> {
  return withTenantSession(scope, async (c) => {
    const rows = (
      await c.query(
        `SELECT ${SAMPLE_COLS} FROM voice_samples
          WHERE pack_id=$1
            AND ($2::boolean OR excluded = false)
            AND ($3::text IS NULL OR channel = $3)
          ORDER BY created_at`,
        [packId, opts.includeExcluded ?? false, opts.channel ?? null],
      )
    ).rows;
    return rows.map(sampleRow);
  });
}

export async function setSampleExcluded(
  scope: SessionScope & { tenantId: string },
  sampleId: string,
  excluded: boolean,
  reason?: string,
): Promise<void> {
  await withTenantSession(scope, (c) =>
    c.query(`UPDATE voice_samples SET excluded=$1, exclusion_reason=$2 WHERE id=$3`, [
      excluded, reason ?? null, sampleId,
    ]),
  );
}

export async function deleteSample(
  scope: SessionScope & { tenantId: string },
  sampleId: string,
): Promise<void> {
  await withTenantSession(scope, (c) => c.query(`DELETE FROM voice_samples WHERE id=$1`, [sampleId]));
}

/**
 * The pieces that go into a prompt.
 *
 * PRIVATE PIECES ARE NEVER RETURNED. Sent email and chat taught us rhythm
 * during the scan; their content does not travel into a draft, so their facts
 * cannot either. This is the single chokepoint for that rule — if a caller
 * wants samples, it comes through here.
 *
 * Benchmarks first (the user said "this is most me"), then pieces from the
 * target platform, then the rest. Capped, because the whole corpus in every
 * prompt is slow and expensive and no better.
 */
export async function fewShotSamples(
  scope: SessionScope & { tenantId: string },
  packId: string,
  channel?: string,
  limit = FEW_SHOT_LIMIT,
): Promise<VoiceSample[]> {
  return withTenantSession(scope, async (c) => {
    const rows = (
      await c.query(
        `SELECT ${SAMPLE_COLS} FROM voice_samples
          WHERE pack_id=$1
            AND visibility='public'
            AND excluded=false
            AND kind <> 'anti_sample'
          ORDER BY (kind='benchmark') DESC,
                   ($2::text IS NOT NULL AND channel=$2) DESC,
                   word_count DESC
          LIMIT $3`,
        [packId, channel ?? null, limit],
      )
    ).rows;
    return rows.map(sampleRow);
  });
}

// ---- the scan ---------------------------------------------------------------

export interface ScanResult {
  stats: CorpusStats;
  measuredChannels: string[];
  inferredChannels: string[];
  suspected: { id?: string; reason: string }[];
  signatureCandidates: { phrase: string; count: number }[];
}

/**
 * Re-measure the corpus and write the measured half of the pack.
 *
 * Only the fields the scan owns are touched — mechanics, the index, the context
 * tags and the corpus stats. Anything the user typed or edited is left exactly
 * as they left it: a re-scan proposes, it never overwrites (spec 01 §6).
 *
 * Private pieces ARE measured here. That is the point of keeping them: they
 * teach how the person writes without their content going anywhere.
 */
export async function rescan(
  scope: SessionScope & { tenantId: string },
  packId: string,
): Promise<ScanResult> {
  const samples = await listSamples(scope, packId);
  const measurement = measureCorpus(
    samples.map((s) => ({
      id: s.id,
      channel: s.channel,
      body: s.body,
      publishedAt: s.publishedAt,
      // Counted, never quoted. Otherwise an opener bank carries a client's
      // name and a figure out of someone's sent mail and into a draft.
      private: s.visibility === "private",
    })),
  );

  const existing = await withTenantSession(scope, async (c) =>
    (await c.query<PackRow>(`${SELECT} WHERE id=$1`, [packId])).rows[0],
  );
  if (!existing) throw new Error("voice pack not found");
  const pack = toPack(existing);

  // Context blocks: measured where the corpus earns it, inferred otherwise.
  const contexts: Record<string, VoiceContext> = { ...pack.contexts };
  const measuredChannels: string[] = [];
  const inferredChannels: string[] = [];
  for (const [channel, pieces] of Object.entries(measurement.piecesByChannel)) {
    if (channel === "unknown") continue;
    const measured = pieces >= MEASURED_CONTEXT_MINIMUM;
    (measured ? measuredChannels : inferredChannels).push(channel);
    contexts[channel] = {
      ...(contexts[channel] ?? { channel }),
      channel,
      tag: measured ? "measured" : "inferred",
      pieceCount: pieces,
    };
  }

  // The user's own never-list and exceptions survive a re-scan untouched.
  const index: VoiceIndex = {
    ...measurement.index,
    neverWords: pack.index.neverWords,
    allowedExceptions: pack.index.allowedExceptions,
    dials: pack.index.dials,
    lastOpeners: pack.index.lastOpeners,
  };

  await withTenantSession(scope, async (c) => {
    await c.query(
      `INSERT INTO voice_pack_versions (tenant_id, pack_id, version, snapshot, note, changed_by)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (pack_id, version) DO NOTHING`,
      [scope.tenantId, packId, pack.version, JSON.stringify(pack),
       `Re-scanned ${measurement.stats.pieces} pieces.`, scope.userId],
    );
    await c.query(
      `UPDATE voice_packs
          SET mechanics = mechanics || $1::jsonb,
              voice_index = $2,
              contexts = $3,
              corpus_stats = $4,
              scanned_at = now(),
              version = version + 1,
              status = CASE WHEN $5::int > 0 THEN 'active' ELSE status END
        WHERE id=$6`,
      [
        JSON.stringify(measurement.mechanics), JSON.stringify(index),
        JSON.stringify(contexts), JSON.stringify(measurement.stats),
        measurement.stats.pieces, packId,
      ],
    );
  });

  return {
    stats: measurement.stats,
    measuredChannels,
    inferredChannels,
    suspected: measurement.suspected,
    signatureCandidates: measurement.signatureCandidates,
  };
}
