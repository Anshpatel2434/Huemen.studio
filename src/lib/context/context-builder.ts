/**
 * THE BRAND CONTEXT OBJECT (INV-2 — brief §03, §05).
 *
 * `brand_profiles + voice_guides + visual_identities` compose into ONE
 * serialised context block, produced by ONE versioned function with ONE output
 * shape. EVERY module injects generation prompts via this. No module assembles
 * its own context — that is how voice drift starts.
 *
 * This module is PURE (no I/O) so it is trivially unit-testable. The DB-backed
 * loader lives in ./context-loader and calls this.
 *
 * `CONTEXT_VERSION` is stamped onto every content_item (via prompt_version) so a
 * bad output can be traced to the exact context shape that produced it.
 */

/**
 * v2 — the VOICE section is composed from the person's Voice Pack (client spec
 * v2) rather than from the brand's voice guide. A voice belongs to a person, so
 * two brands run by the same human now speak in one voice instead of two.
 * `voiceGuide` is still read when a tenant has no pack yet.
 */
export const CONTEXT_VERSION = 2;

// ---- Input shapes (all fields optional: the foundation may be thin) ---------

export interface StoryChapter {
  chapter?: number;
  title?: string;
  body?: string;
}

export interface BrandProfileInput {
  storyArc?: StoryChapter[];
  positioningStatement?: string | null;
  niche?: string | null;
  audience?: Record<string, unknown> | null;
  offersSummary?: string | null;
}

export interface VoiceGuideInput {
  toneDescriptors?: string[];
  doWords?: string[];
  dontWords?: string[];
  samplePosts?: string[];
  readingLevel?: string | null;
  formattingRules?: Record<string, unknown> | null;
}

export interface VisualIdentityInput {
  palette?: string[];
  fonts?: string[];
  imageStyleNotes?: string | null;
  aspectRatioDefaults?: Record<string, string> | null;
}

/**
 * The person's voice, flattened for the prompt. Built by the caller from a
 * VoicePack (see lib/data/voice-pack) so this module stays pure.
 *
 * `samples` arrives already filtered and capped: public pieces only, at most a
 * handful. Private writing teaches rhythm during the scan and never travels
 * into a prompt, and the whole corpus in every prompt is slow and no better.
 */
export interface VoicePackInput {
  voiceLine?: string | null;
  hardRules?: string[];
  toneDescriptors?: string[];
  personalityWords?: { word: string; meaning: string }[];
  reader?: string | null;
  carries?: string | null;
  humour?: string | null;
  readingLevel?: string | null;
  guardrails?: { rule: string; why?: string; instead?: string }[];
  neverWords?: string[];
  mustHaves?: string[];
  /** Measured numbers, already rendered as short lines. */
  mechanicsLines?: string[];
  /** The block for the platform being written for, if there is one. */
  context?: { channel: string; tag: "measured" | "inferred"; lines: string[] } | null;
  samples?: { channel: string; body: string }[];
  corpusPieces?: number;
}

export interface BrandContextInput {
  brandProfile?: BrandProfileInput | null;
  /** The person's Voice Pack. Supersedes `voiceGuide` when present. */
  voicePack?: VoicePackInput | null;
  /** Legacy per-brand voice guide. Read only when there is no pack yet. */
  voiceGuide?: VoiceGuideInput | null;
  visualIdentity?: VisualIdentityInput | null;
  /** Structured so language is a parameter for later i18n (§09). Default 'en'. */
  language?: string;
}

// ---- Output shape (stable) --------------------------------------------------

export interface BrandContext {
  version: number;
  language: string;
  /** 0–100. Feeds the completeness indicator (brief §4.1, P1-10). */
  completeness: number;
  /** Human-readable warnings about thin sections; surfaced in the studio UI. */
  warnings: string[];
  /** True when the foundation is too thin for reliably on-brand output. */
  degraded: boolean;
  /** The serialised block injected into every prompt. Deterministic. */
  serialized: string;
  /** Structured voice guardrails for post-generation checking (brief §4.2). */
  guardrails: { doWords: string[]; dontWords: string[] };
}

const DEGRADED_THRESHOLD = 50;

function nonEmpty(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

/**
 * Completeness weights sum to 100. Each section contributes when populated.
 * Keep this deterministic — the same input must always yield the same score.
 */
function scoreCompleteness(input: BrandContextInput): {
  score: number;
  warnings: string[];
} {
  const warnings: string[] = [];
  let score = 0;
  const bp = input.brandProfile ?? {};
  const vg = input.voiceGuide ?? {};
  const vi = input.visualIdentity ?? {};

  // Brand profile — 50 pts
  const filledChapters = (bp.storyArc ?? []).filter((c) => nonEmpty(c?.body)).length;
  if (filledChapters >= 3) score += 15;
  else {
    score += filledChapters * 5;
    warnings.push(`Story arc has ${filledChapters}/3 chapters written.`);
  }
  if (nonEmpty(bp.positioningStatement)) score += 15;
  else warnings.push("Positioning statement is empty.");
  if (nonEmpty(bp.niche)) score += 10;
  else warnings.push("Niche is not defined.");
  if (bp.audience && Object.keys(bp.audience).length > 0) score += 10;
  else warnings.push("Audience is not defined.");

  // Voice — 35 pts. Scored from the Voice Pack when there is one, because the
  // pack is where a voice lives now; the old guide is the fallback.
  const vp = input.voicePack;
  if (vp) {
    const pieces = vp.corpusPieces ?? 0;
    // Real writing is most of "sounds like me", so it carries most of the score.
    if (pieces >= 10) score += 15;
    else if (pieces > 0) {
      score += Math.round((pieces / 10) * 15);
      warnings.push(`Only ${pieces} piece${pieces === 1 ? "" : "s"} of real writing — the voice is provisional.`);
    } else warnings.push("No real writing yet — the voice is guesswork until something is added.");

    if ((vp.mechanicsLines ?? []).length > 0) score += 10;
    else warnings.push("Nothing measured yet — run the scan to fill the voice fingerprint.");

    if ((vp.guardrails ?? []).length > 0 || (vp.neverWords ?? []).length > 0) score += 10;
    else warnings.push("No guardrails — nothing is off-limits, which is rarely true.");
  } else {
    if ((vg.toneDescriptors ?? []).length > 0) score += 10;
    else warnings.push("No tone descriptors set — voice may read generic.");
    if ((vg.samplePosts ?? []).filter(nonEmpty).length >= 3) score += 15;
    else
      warnings.push(
        "Fewer than 3 sample posts — voice matching will be weaker.",
      );
    if ((vg.doWords ?? []).length > 0 || (vg.dontWords ?? []).length > 0) score += 10;
    else warnings.push("No do/don't words — voice guardrails are off.");
  }

  // Visual identity — 15 pts
  if ((vi.palette ?? []).length > 0) score += 8;
  else warnings.push("No brand palette — images will not be colour-matched.");
  if (nonEmpty(vi.imageStyleNotes)) score += 7;
  else warnings.push("No image style notes — images may look generic.");

  return { score: Math.min(100, score), warnings };
}

/**
 * The VOICE section, in the order the spec loads it (01 §3, 07):
 * who they are, the rules that beat everything, the measured fingerprint, how
 * they behave on this platform, then their real writing.
 *
 * The hard rules come first and are stated as overrides, because a rule buried
 * under three paragraphs of description is a rule that gets ignored.
 */
function serializeVoicePack(vp: VoicePackInput): string[] {
  const out: string[] = ["## VOICE"];
  if (nonEmpty(vp.voiceLine)) out.push(`In one line: ${vp.voiceLine!.trim()}`);

  const rules = (vp.hardRules ?? []).filter(nonEmpty);
  if (rules.length) {
    out.push("Hard rules — these override every other instruction:");
    rules.forEach((r, i) => out.push(`  ${i + 1}. ${r.trim()}`));
  }

  if ((vp.toneDescriptors ?? []).length) out.push(`Tone: ${vp.toneDescriptors!.join(", ")}`);
  const pw = (vp.personalityWords ?? []).filter((w) => nonEmpty(w?.word));
  if (pw.length)
    out.push(
      `Personality: ${pw.map((w) => (nonEmpty(w.meaning) ? `${w.word} (${w.meaning})` : w.word)).join(" · ")}`,
    );
  if (nonEmpty(vp.reader)) out.push(`Writing to: ${vp.reader!.trim()}`);
  if (nonEmpty(vp.carries)) out.push(`Every piece quietly carries: ${vp.carries!.trim()}`);
  if (nonEmpty(vp.humour)) out.push(`Humour: ${vp.humour!.trim()}`);
  if (nonEmpty(vp.readingLevel)) out.push(`Reading level: ${vp.readingLevel}`);

  // A guardrail without its reason cannot generalise past the case it names.
  const guards = (vp.guardrails ?? []).filter((g) => nonEmpty(g?.rule));
  if (guards.length) {
    out.push("Guardrails (breaking one makes the output wrong, however well written):");
    guards.forEach((g) => {
      const why = nonEmpty(g.why) ? ` Why: ${g.why!.trim()}` : "";
      const instead = nonEmpty(g.instead) ? ` Instead: ${g.instead!.trim()}` : "";
      out.push(`  - ${g.rule.trim()}${why}${instead}`);
    });
  }
  if ((vp.neverWords ?? []).length) out.push(`Never use: ${vp.neverWords!.join(", ")}`);
  if ((vp.mustHaves ?? []).length) out.push(`Every piece has: ${vp.mustHaves!.join(", ")}`);

  const mech = (vp.mechanicsLines ?? []).filter(nonEmpty);
  if (mech.length) {
    out.push("Measured fingerprint (hit these, they come from their own writing):");
    mech.forEach((l) => out.push(`  - ${l}`));
  }

  if (vp.context) {
    const { channel, tag, lines: ctxLines } = vp.context;
    out.push(`On ${channel} (${tag}):`);
    ctxLines.filter(nonEmpty).forEach((l) => out.push(`  - ${l}`));
    if (tag === "inferred")
      out.push("  - No real writing from this platform yet, so keep close to the general voice.");
  }

  const samples = (vp.samples ?? []).filter((s) => nonEmpty(s?.body));
  if (samples.length) {
    out.push("Their real writing. Match the rhythm and word choice. Never copy a sentence:");
    samples.forEach((s, i) => out.push(`  [${i + 1}] (${s.channel}) ${s.body.trim()}`));
  } else {
    out.push("No real writing on file yet — this voice is provisional. Do not invent a style.");
  }
  return out;
}

function serialize(input: BrandContextInput): string {
  const bp = input.brandProfile ?? {};
  const vg = input.voiceGuide ?? {};
  const vi = input.visualIdentity ?? {};
  const lines: string[] = [];

  lines.push("## BRAND FOUNDATION");
  if (nonEmpty(bp.niche)) lines.push(`Niche: ${bp.niche!.trim()}`);
  if (nonEmpty(bp.positioningStatement))
    lines.push(`Positioning: ${bp.positioningStatement!.trim()}`);
  if (bp.audience && Object.keys(bp.audience).length > 0)
    lines.push(`Audience: ${JSON.stringify(bp.audience)}`);
  const chapters = (bp.storyArc ?? [])
    .filter((c) => nonEmpty(c?.title) || nonEmpty(c?.body))
    .map(
      (c, i) =>
        `  ${c.chapter ?? i + 1}. ${nonEmpty(c.title) ? c.title!.trim() + " — " : ""}${(c.body ?? "").trim()}`,
    );
  if (chapters.length) lines.push("Story arc:", ...chapters);
  if (nonEmpty(bp.offersSummary)) lines.push(`Offers: ${bp.offersSummary!.trim()}`);

  if (input.voicePack) lines.push("", ...serializeVoicePack(input.voicePack));
  else {
    lines.push("", "## VOICE");
    if ((vg.toneDescriptors ?? []).length)
      lines.push(`Tone: ${vg.toneDescriptors!.join(", ")}`);
    if (nonEmpty(vg.readingLevel)) lines.push(`Reading level: ${vg.readingLevel}`);
    if ((vg.doWords ?? []).length) lines.push(`Prefer words: ${vg.doWords!.join(", ")}`);
    if ((vg.dontWords ?? []).length) lines.push(`Avoid words: ${vg.dontWords!.join(", ")}`);
    if (vg.formattingRules && Object.keys(vg.formattingRules).length)
      lines.push(`Formatting: ${JSON.stringify(vg.formattingRules)}`);
    const samples = (vg.samplePosts ?? []).filter(nonEmpty);
    if (samples.length) {
      lines.push("Sample posts (match this voice):");
      samples.forEach((s, i) => lines.push(`  [${i + 1}] ${s.trim()}`));
    }
  }

  lines.push("", "## VISUAL IDENTITY");
  if ((vi.palette ?? []).length) lines.push(`Palette: ${vi.palette!.join(", ")}`);
  if ((vi.fonts ?? []).length) lines.push(`Fonts: ${vi.fonts!.join(", ")}`);
  if (nonEmpty(vi.imageStyleNotes)) lines.push(`Image style: ${vi.imageStyleNotes!.trim()}`);
  if (vi.aspectRatioDefaults && Object.keys(vi.aspectRatioDefaults).length)
    lines.push(`Aspect ratios: ${JSON.stringify(vi.aspectRatioDefaults)}`);

  return lines.join("\n");
}

/**
 * Compose the single, versioned brand context block. Deterministic and pure.
 */
export function buildBrandContext(input: BrandContextInput): BrandContext {
  const language = input.language ?? "en";
  const { score, warnings } = scoreCompleteness(input);
  return {
    version: CONTEXT_VERSION,
    language,
    completeness: score,
    warnings,
    degraded: score < DEGRADED_THRESHOLD,
    serialized: serialize(input),
    guardrails: {
      doWords: input.voiceGuide?.doWords ?? [],
      // The pack's never-list is the person's own; it replaces the brand's.
      dontWords: input.voicePack?.neverWords ?? input.voiceGuide?.dontWords ?? [],
    },
  };
}
