/**
 * Brand Foundation data access (brief §4.1). Loads/saves the editable brand
 * profile + voice guide + visual identity for a tenant scope, and recomputes
 * completeness through the ONE versioned context builder (INV-2) on save so the
 * studio degradation signal (P1-10) stays truthful.
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession } from "@/db/session";
import type { WorkspaceScope } from "./projects";
import { buildBrandContext } from "@/lib/context/context-builder";
import { addSamples, listSamples, loadPackForWorkspace, savePack } from "./voice-pack";
import { packToContextInput } from "@/lib/voice/context";
import { tagged, type VoicePack } from "@/lib/voice/types";

import type { FoundationForm } from "./foundation-types";
export type { FoundationForm };

/**
 * The brief's voice fields are now a VIEW of the person's Voice Pack, not their
 * own record (client spec v2: a voice belongs to a person, not a brand). The
 * form keeps its shape so every screen that reads it still works; the values
 * come from and go back to the pack.
 *
 * Sample posts are the awkward part: a real post has line breaks, and this
 * field shows one per line. So pieces are SHOWN collapsed onto one line, and on
 * save a line is added to the corpus only if no existing piece collapses to the
 * same thing. The stored piece keeps its line breaks; re-saving adds nothing.
 */
const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

const EMPTY: FoundationForm = {
  niche: "",
  positioning: "",
  offers: "",
  audience: "",
  chapters: [
    { title: "", body: "" },
    { title: "", body: "" },
    { title: "", body: "" },
  ],
  tone: "",
  doWords: "",
  dontWords: "",
  readingLevel: "",
  samplePosts: "",
  palette: "",
  fonts: "",
  imageStyleNotes: "",
};

const csv = (s: string): string[] =>
  s.split(",").map((x) => x.trim()).filter(Boolean);
const lines = (s: string): string[] =>
  s.split("\n").map((x) => x.trim()).filter(Boolean);

export async function loadFoundation(scope: WorkspaceScope): Promise<FoundationForm> {
  const pack = await loadPackForWorkspace(scope);
  const corpus = pack ? await listSamples(scope, pack.id) : [];

  const form = await withTenantSession(scope, async (c) => {
    const bp = (
      await c.query(
        `SELECT * FROM brand_profiles WHERE project_id IS NULL ORDER BY status='active' DESC, updated_at DESC LIMIT 1`,
      )
    ).rows[0];
    if (!bp) return EMPTY;

    const vg = (
      await c.query(`SELECT * FROM voice_guides WHERE brand_profile_id=$1 LIMIT 1`, [bp.id])
    ).rows[0];
    const vi = (
      await c.query(`SELECT * FROM visual_identities WHERE brand_profile_id=$1 LIMIT 1`, [bp.id])
    ).rows[0];

    const arc = (bp.story_arc ?? []) as { title?: string; body?: string }[];
    const chapters = [0, 1, 2].map((i) => ({
      title: arc[i]?.title ?? "",
      body: arc[i]?.body ?? "",
    }));

    return {
      niche: bp.niche ?? "",
      positioning: bp.positioning_statement ?? "",
      offers: bp.offers_summary ?? "",
      // Editor writes {description}; older/seeded rows may hold structured keys.
      audience:
        (bp.audience?.description as string) ??
        Object.entries(bp.audience ?? {}).map(([k, v]) => `${k}: ${v}`).join("; "),
      chapters,
      tone: (vg?.tone_descriptors ?? []).join(", "),
      doWords: (vg?.do_words ?? []).join(", "),
      dontWords: (vg?.dont_words ?? []).join(", "),
      readingLevel: vg?.reading_level ?? "",
      samplePosts: (vg?.sample_posts ?? []).join("\n"),
      palette: (vi?.palette ?? []).join(", "),
      fonts: (vi?.fonts ?? []).join(", "),
      imageStyleNotes: vi?.image_style_notes ?? "",
    };
  });

  if (!pack) return form;
  // The pack owns the voice. Only fall back to the old guide where it is silent.
  return {
    ...form,
    tone: (pack.identity.toneDescriptors?.value ?? []).join(", ") || form.tone,
    doWords: (pack.mechanics.lexicon?.value ?? []).join(", ") || form.doWords,
    dontWords:
      (pack.index.neverWords.length
        ? pack.index.neverWords
        : (pack.redPen.neverList?.value ?? [])
      ).join(", ") || form.dontWords,
    readingLevel: pack.mechanics.readingLevel?.value ?? form.readingLevel,
    samplePosts: corpus.length
      ? corpus.map((s) => collapse(s.body)).join("\n")
      : form.samplePosts,
  };
}

export async function saveFoundation(
  scope: WorkspaceScope,
  form: FoundationForm,
): Promise<number> {
  const storyArc = form.chapters.map((ch, i) => ({
    chapter: i + 1,
    title: ch.title,
    body: ch.body,
  }));
  const audience = form.audience ? { description: form.audience } : {};

  // The voice half of the form goes to the person's pack, which is what every
  // prompt now reads. Writing it to voice_guides as well would be writing to a
  // record nothing loads — a silent no-op the user would read as data loss.
  const pack = await loadPackForWorkspace(scope);
  let saved: VoicePack | null = pack;
  if (pack) {
    const tone = csv(form.tone);
    const doW = csv(form.doWords);
    const never = csv(form.dontWords);
    saved =
      (await savePack(
        scope,
        pack.id,
        {
          identity: { ...pack.identity, toneDescriptors: tagged(tone, "ask") },
          mechanics: {
            ...pack.mechanics,
            // Never overwrite a measured lexicon with what someone typed.
            lexicon:
              pack.mechanics.lexicon?.confidence === "measured"
                ? pack.mechanics.lexicon
                : tagged(doW, "ask"),
            readingLevel: tagged(form.readingLevel, "ask"),
          },
          redPen: { ...pack.redPen, neverList: tagged(never, "ask") },
          index: { ...pack.index, neverWords: never },
        },
        "Edited in the brief.",
      )) ?? pack;

    const existing = await listSamples(scope, pack.id);
    const seen = new Set(existing.map((s) => collapse(s.body)));
    const added = lines(form.samplePosts).filter((l) => !seen.has(collapse(l)));
    if (added.length) {
      await addSamples(
        scope,
        pack.id,
        added.map((body) => ({ body, source: "intake" as const, visibility: "public" as const })),
      );
    }
  }

  const corpusCount = saved
    ? (await listSamples(scope, saved.id)).length
    : 0;

  // Recompute completeness via the single builder (INV-2).
  const ctx = buildBrandContext({
    voicePack: saved
      ? { ...packToContextInput(saved, []), corpusPieces: corpusCount }
      : null,
    brandProfile: {
      storyArc,
      positioningStatement: form.positioning,
      niche: form.niche,
      audience,
      offersSummary: form.offers,
    },
    voiceGuide: {
      toneDescriptors: csv(form.tone),
      doWords: csv(form.doWords),
      dontWords: csv(form.dontWords),
      samplePosts: lines(form.samplePosts),
      readingLevel: form.readingLevel,
    },
    visualIdentity: {
      palette: csv(form.palette),
      fonts: csv(form.fonts),
      imageStyleNotes: form.imageStyleNotes,
    },
  });

  return withTenantSession(scope, async (c) => {
    const tenantId = scope.tenantId!;
    const existing = (
      await c.query(
        `SELECT id FROM brand_profiles WHERE project_id IS NULL ORDER BY status='active' DESC, updated_at DESC LIMIT 1`,
      )
    ).rows[0];

    let profileId: string;
    if (existing) {
      profileId = existing.id;
      await c.query(
        `UPDATE brand_profiles SET niche=$1, positioning_statement=$2, offers_summary=$3,
           audience=$4, story_arc=$5, completeness=$6, status='active' WHERE id=$7`,
        [form.niche, form.positioning, form.offers, JSON.stringify(audience),
         JSON.stringify(storyArc), ctx.completeness, profileId],
      );
    } else {
      profileId = (
        await c.query(
          `INSERT INTO brand_profiles
             (tenant_id, project_id, status, niche, positioning_statement, offers_summary, audience, story_arc, completeness)
           VALUES ($1,NULL,'active',$2,$3,$4,$5,$6,$7) RETURNING id`,
          [tenantId, form.niche, form.positioning, form.offers,
           JSON.stringify(audience), JSON.stringify(storyArc), ctx.completeness],
        )
      ).rows[0].id;
    }

    // Point the brand at the person whose voice it speaks in. Done here rather
    // than earlier because a brand new project has no brand_profile row to link
    // until the line above creates it.
    if (saved) {
      await c.query(
        `UPDATE brand_profiles SET voice_pack_id=$1 WHERE id=$2 AND voice_pack_id IS DISTINCT FROM $1`,
        [saved.id, profileId],
      );
    }

    // Voice guide upsert — ONLY where this person has no pack. With a pack the
    // voice was already saved above, and this table is no longer read, so
    // writing to it would be a silent no-op the user would read as data loss.
    if (!saved) {
      const vgId = (
        await c.query(`SELECT id FROM voice_guides WHERE brand_profile_id=$1 LIMIT 1`, [profileId])
      ).rows[0]?.id;
      const vgVals = [
        JSON.stringify(csv(form.tone)), csv(form.doWords), csv(form.dontWords),
        JSON.stringify(lines(form.samplePosts)), form.readingLevel,
      ];
      if (vgId) {
        await c.query(
          `UPDATE voice_guides SET tone_descriptors=$1, do_words=$2, dont_words=$3,
             sample_posts=$4, reading_level=$5 WHERE id=$6`,
          [...vgVals, vgId],
        );
      } else {
        await c.query(
          `INSERT INTO voice_guides
             (tenant_id, brand_profile_id, tone_descriptors, do_words, dont_words, sample_posts, reading_level)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tenantId, profileId, ...vgVals],
        );
      }
    }

    // Visual identity upsert.
    const viId = (
      await c.query(`SELECT id FROM visual_identities WHERE brand_profile_id=$1 LIMIT 1`, [profileId])
    ).rows[0]?.id;
    const viVals = [JSON.stringify(csv(form.palette)), JSON.stringify(csv(form.fonts)), form.imageStyleNotes];
    if (viId) {
      await c.query(
        `UPDATE visual_identities SET palette=$1, fonts=$2, image_style_notes=$3 WHERE id=$4`,
        [...viVals, viId],
      );
    } else {
      await c.query(
        `INSERT INTO visual_identities
           (tenant_id, brand_profile_id, palette, fonts, image_style_notes)
         VALUES ($1,$2,$3,$4,$5)`,
        [tenantId, profileId, ...viVals],
      );
    }

    return ctx.completeness;
  });
}

// ---------------------------------------------------------------- answers ---

/**
 * The strategy answers from onboarding ("what do you want to be known for",
 * "what do you believe that most people would argue with"). They describe the
 * person, not a piece, so they live on the workspace brief (migration 0008) and
 * the pillar generator reads them from here.
 */
export interface StrategyAnswer {
  key: string;
  question: string;
  answer: string;
}

export async function loadBriefAnswers(scope: WorkspaceScope): Promise<StrategyAnswer[]> {
  return withTenantSession(scope, async (c) => {
    const row = (
      await c.query<{ brief_answers: StrategyAnswer[] }>(
        `SELECT brief_answers FROM brand_profiles
          WHERE project_id IS NULL ORDER BY status='active' DESC, updated_at DESC LIMIT 1`,
      )
    ).rows[0];
    return (row?.brief_answers ?? []).filter((a) => a?.answer?.trim());
  });
}

/** Merge answers in by key, so answering one question never clears the rest. */
export async function saveBriefAnswers(scope: WorkspaceScope, answers: StrategyAnswer[]): Promise<void> {
  const current = await loadBriefAnswers(scope);
  const byKey = new Map(current.map((a) => [a.key, a]));
  for (const a of answers) {
    if (a.answer?.trim()) byKey.set(a.key, a);
  }
  await withTenantSession(scope, (c) =>
    c.query(
      `UPDATE brand_profiles SET brief_answers = $1
        WHERE project_id IS NULL AND status = 'active'`,
      [JSON.stringify([...byKey.values()])],
    ),
  );
}
