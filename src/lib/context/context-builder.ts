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
/*
 * v3 — the VOICE section also carries what onboarding now collects: their
 * stories, the facts they can stand behind (the only facts a draft may use),
 * the voices they admire and avoid, how they mix languages, and their
 * "this or that" picks as paired examples.
 */
/*
 * v4 — Voice Pack v2 in full. Everything onboarding asks now reaches the
 * prompt (the party answers, dials, persona, roots, feelings, sign-offs, tone
 * shifts), plus the red pen (exceptions, self-check), benchmark notes and the
 * anti-sample. And the voice is loaded per TASK in the spec's order (01 §3):
 * write, rewrite, check and short reply each load only what they need. The
 * check also carries their aspiration, so a draft aimed where they want to
 * sound isn't marked down for not matching their old writing.
 */
export const CONTEXT_VERSION = 6; // 6: Visual Core, beliefs, pillars and strategy answers are in the block (no task input carries brand data)

/** What the context is for (spec 01 §3 load order). Undefined reads as "write". */
export type ContextTask = "write" | "rewrite" | "check" | "reply";

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
  /** The offer designer's saved offers (brief §4.4): reusable as context for pitch emails. */
  offers?: { name: string; format?: string | null; promise?: string | null }[];
  /** The workspace's content pillars: every piece sits under one (INV-2: in the block, not in task inputs). */
  pillars?: { name: string; description?: string | null }[];
  /** Pre-workshop and onboarding strategy answers, as "key: answer" (migration 0008). */
  strategyAnswers?: { key: string; answer: string }[];
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
  /** Colour use, layout, motifs and photo style (Visual Core, migration 0016). */
  coreLines?: string[];
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
  samples?: { channel: string; body: string; note?: string }[];
  stories?: { title: string; body: string; lesson?: string }[];
  /** Their point of view: beliefs a piece may argue from (M1). */
  beliefs?: string[];
  proofs?: { claim: string; source?: string }[];
  influences?: { admire: string[]; avoid: string[] } | null;
  languages?: { primary: string; also: string[]; when?: string } | null;
  preferences?: { chosen: string; over: string }[];
  corpusPieces?: number;
  /** A1: what they do, in their own words. */
  whatTheyDo?: string | null;
  /** A3 / B4: who they are to the reader. */
  personaRoles?: string[];
  quadrant?: string | null;
  /** C4, rendered as "Fun–Serious 3 (leans fun)". */
  dials?: { left: string; right: string; value: number }[];
  /** H1: they chose how they want to sound over how they wrote. */
  dialsAspiration?: boolean;
  /** The quadrant is where they want to be (C3); `quadrantToday` is where their writing sits. */
  quadrantAspiration?: boolean;
  quadrantToday?: string | null;
  /** C1 / C2: the voice lives between these two. */
  guarded?: string | null;
  unguarded?: string | null;
  feelings?: { skim?: string; read?: string; talk?: string } | null;
  /** B1: why they sound this way. */
  roots?: string | null;
  /** C10 as answered in the question bank. */
  languageNote?: string | null;
  /** A5, A6, B2, B4, labelled. */
  notes?: { label: string; text: string }[];
  /** F3: how the tone shifts by moment. */
  situations?: { moment: string; how: string }[];
  /** F5: exact sign-offs by place. */
  signOffs?: { place: string; text: string }[];
  /** red-pen.md */
  exceptions?: string[];
  selfCheck?: string[];
  /** samples.md: a draft that is almost them but wrong, with what's off (G4). */
  antiSample?: { text: string; off: string; fixed?: string } | null;
}

/**
 * The rules of the platform being written for (lib/voice/platforms, spec file
 * 07). System level: the same for every person. Rendered between the measured
 * fingerprint and the person's own block for that platform — the spec's load
 * order — so their habits sit on top of the platform's norms, never under them.
 */
export interface PlatformInput {
  label: string;
  lines: string[];
}

export interface BrandContextInput {
  /** The platform this context is being built for, if any. */
  platform?: PlatformInput | null;
  brandProfile?: BrandProfileInput | null;
  /** The person's Voice Pack. Supersedes `voiceGuide` when present. */
  voicePack?: VoicePackInput | null;
  /** Legacy per-brand voice guide. Read only when there is no pack yet. */
  voiceGuide?: VoiceGuideInput | null;
  visualIdentity?: VisualIdentityInput | null;
  /** Structured so language is a parameter for later i18n (§09). Default 'en'. */
  language?: string;
  /** What the context is for; decides which voice parts load, in what order. */
  task?: ContextTask;
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
function serializePlatform(p: PlatformInput): string[] {
  const lines = p.lines.filter(nonEmpty);
  if (!lines.length) return [];
  // Spec 07 precedence: hard limits > guardrails > their platform habits > platform norms.
  return [`Platform: ${p.label}. Its hard limits beat every other instruction, the guardrails included:`, ...lines.map((l) => `  - ${l}`)];
}

// ---- the voice, one part per file of the Voice Pack ---------------------------

/** VOICE.md: always loaded first, whatever the task. */
function voiceCore(vp: VoicePackInput): string[] {
  const out: string[] = ["## VOICE"];
  if (nonEmpty(vp.voiceLine)) out.push(`In one line: ${vp.voiceLine!.trim()}`);
  const rules = (vp.hardRules ?? []).filter(nonEmpty);
  if (rules.length) {
    out.push("Hard rules — these override every other instruction:");
    rules.forEach((r, i) => out.push(`  ${i + 1}. ${r.trim()}`));
  }
  return out;
}

/** guardrails.md. A guardrail without its reason cannot generalise past the case it names. */
function voiceGuardrails(vp: VoicePackInput): string[] {
  const out: string[] = [];
  const guards = (vp.guardrails ?? []).filter((g) => nonEmpty(g?.rule));
  if (guards.length) {
    out.push("Guardrails (breaking one makes the output wrong, however well written):");
    guards.forEach((g) => {
      const why = nonEmpty(g.why) ? ` Why: ${g.why!.trim()}` : "";
      const instead = nonEmpty(g.instead) ? ` Instead: ${g.instead!.trim()}` : "";
      out.push(`  - ${g.rule.trim()}${why}${instead}`);
    });
  }
  if (vp.influences?.avoid.length) out.push(`Must never sound like: ${vp.influences.avoid.join("; ")}`);
  return out;
}

/** mechanics.md: the measured fingerprint. */
function voiceMechanics(vp: VoicePackInput): string[] {
  const mech = (vp.mechanicsLines ?? []).filter(nonEmpty);
  return mech.length ? ["Measured fingerprint (hit these, they come from their own writing):", ...mech.map((l) => `  - ${l}`)] : [];
}

/** contexts.md for the platform being written for, under the platform's own rules (07). */
function voiceContext(vp: VoicePackInput, platform?: PlatformInput | null): string[] {
  const out: string[] = [];
  if (platform) out.push(...serializePlatform(platform));
  if (vp.context) {
    const { channel, tag, lines: ctxLines } = vp.context;
    out.push(`How they write on ${channel} (${tag}):`);
    ctxLines.filter(nonEmpty).forEach((l) => out.push(`  - ${l}`));
    if (tag === "inferred") out.push("  - No real writing from this platform yet, so keep close to the general voice.");
  }
  return out;
}

/** samples.md: their picks, their writing (platform first), and the edge of the voice. */
function voiceSamples(vp: VoicePackInput): string[] {
  const out: string[] = [];
  const prefs = (vp.preferences ?? []).filter((p) => nonEmpty(p?.chosen));
  if (prefs.length) {
    out.push("Lines they picked as more like them, over a near-identical twin:");
    prefs.forEach((p) => out.push(`  + "${p.chosen.trim()}"  rather than  "${p.over.trim()}"`));
  }
  const samples = (vp.samples ?? []).filter((s) => nonEmpty(s?.body));
  if (samples.length) {
    out.push("Their real writing. Match the rhythm and word choice. Never copy a sentence:");
    samples.forEach((s, i) => {
      out.push(`  [${i + 1}] (${s.channel}) ${s.body.trim()}`);
      if (nonEmpty(s.note)) out.push(`      Why this is them: ${s.note!.trim()}`);
    });
  } else {
    out.push("No real writing on file yet — this voice is provisional. Do not invent a style.");
  }
  if (vp.antiSample && nonEmpty(vp.antiSample.text)) {
    out.push(`Almost them, but wrong: "${vp.antiSample.text.trim()}"`);
    if (nonEmpty(vp.antiSample.off)) out.push(`  What's off: ${vp.antiSample.off.trim()}`);
    if (nonEmpty(vp.antiSample.fixed)) out.push(`  Fixed: "${vp.antiSample.fixed!.trim()}"`);
  }
  return out;
}

const DIAL_LEAN = (d: { left: string; right: string; value: number }) =>
  d.value <= 3 ? `leans ${d.left.toLowerCase()}` : d.value >= 8 ? `leans ${d.right.toLowerCase()}` : "in between";

/** identity.md: who is speaking. Loaded last for writing, per the spec. */
/**
 * For the check: where they want to sound, when it differs from their corpus
 * (C3 compass, C4 dials). Without it the judge marks a deliberate move toward
 * their aspiration as drift.
 */
function voiceAspiration(vp: VoicePackInput): string[] {
  const out: string[] = [];
  if (vp.quadrantAspiration && nonEmpty(vp.quadrant))
    out.push(`They want to sound like a ${vp.quadrant}${nonEmpty(vp.quadrantToday) ? `; their past writing reads more like a ${vp.quadrantToday}` : ""}.`);
  const dials = (vp.dials ?? []).filter((d) => d.value >= 1 && d.value <= 10);
  if (vp.dialsAspiration && dials.length)
    out.push(`Where they want the dials, 1 to 10: ${dials.map((d) => `${d.left}–${d.right} ${d.value}`).join(" · ")}.`);
  if (!out.length) return [];
  return ["Where they're heading (a move toward this is on-voice, not drift):", ...out.map((l) => `  - ${l}`)];
}

function voiceIdentity(vp: VoicePackInput): string[] {
  const out: string[] = [];
  if (nonEmpty(vp.whatTheyDo)) out.push(`What they do, in their words: ${vp.whatTheyDo!.trim()}`);
  if ((vp.personaRoles ?? []).length) out.push(`To their reader they are: ${vp.personaRoles!.join("; ")}`);
  if (nonEmpty(vp.quadrant)) out.push(`Personality quadrant: ${vp.quadrant}`);
  if ((vp.toneDescriptors ?? []).length) out.push(`Tone: ${vp.toneDescriptors!.join(", ")}`);
  const pw = (vp.personalityWords ?? []).filter((w) => nonEmpty(w?.word));
  if (pw.length)
    out.push(`Personality: ${pw.map((w) => (nonEmpty(w.meaning) ? `${w.word} (${w.meaning})` : w.word)).join(" · ")}`);
  const dials = (vp.dials ?? []).filter((d) => d.value >= 1 && d.value <= 10);
  if (dials.length) {
    out.push(
      `Dials, 1 to 10: ${dials.map((d) => `${d.left}–${d.right} ${d.value} (${DIAL_LEAN(d)})`).join(" · ")}`,
    );
    if (vp.dialsAspiration)
      out.push("  These are where they want to sound, not where their old writing sits. Aim here.");
  }
  if (nonEmpty(vp.reader)) out.push(`Writing to: ${vp.reader!.trim()}`);
  if (nonEmpty(vp.carries)) out.push(`Every piece quietly carries: ${vp.carries!.trim()}`);
  if (nonEmpty(vp.guarded) || nonEmpty(vp.unguarded)) {
    out.push("Guarded and unguarded (the real voice lives between the two; never looser than the second):");
    if (nonEmpty(vp.guarded)) out.push(`  - In public, sober: ${vp.guarded!.trim()}`);
    if (nonEmpty(vp.unguarded)) out.push(`  - Guard down: ${vp.unguarded!.trim()}`);
  }
  const f = vp.feelings;
  if (f && (nonEmpty(f.skim) || nonEmpty(f.read) || nonEmpty(f.talk))) {
    out.push("What a reader should feel:");
    if (nonEmpty(f.skim)) out.push(`  - After a 30-second skim: ${f.skim!.trim()}`);
    if (nonEmpty(f.read)) out.push(`  - After a 5-minute read: ${f.read!.trim()}`);
    if (nonEmpty(f.talk)) out.push(`  - After a 20-minute conversation: ${f.talk!.trim()}`);
  }
  if (nonEmpty(vp.roots)) out.push(`Where the voice comes from: ${vp.roots!.trim()}`);
  if (nonEmpty(vp.humour)) out.push(`Humour: ${vp.humour!.trim()}`);
  if (nonEmpty(vp.readingLevel)) out.push(`Reading level: ${vp.readingLevel}`);
  if (vp.languages) {
    const also = vp.languages.also.length ? `, mixing in ${vp.languages.also.join(", ")}` : "";
    out.push(`Language: ${vp.languages.primary}${also}${nonEmpty(vp.languages.when) ? ` (${vp.languages.when!.trim()})` : ""}.`);
  } else if (nonEmpty(vp.languageNote)) out.push(`Language: ${vp.languageNote!.trim()}`);
  if (vp.influences?.admire.length)
    out.push(`Admires how these write (borrow the qualities, never the words): ${vp.influences.admire.join("; ")}`);
  (vp.notes ?? []).filter((n) => nonEmpty(n.text)).forEach((n) => out.push(`${n.label}: ${n.text.trim()}`));
  const sit = (vp.situations ?? []).filter((s) => nonEmpty(s.how));
  if (sit.length) {
    out.push("How their tone shifts:");
    sit.forEach((s) => out.push(`  - ${s.moment}: ${s.how.trim()}`));
  }
  const so = (vp.signOffs ?? []).filter((s) => nonEmpty(s.text));
  if (so.length) out.push(`Sign-offs, exactly: ${so.map((s) => `${s.place}: "${s.text.trim()}"`).join(" · ")}`);
  return out;
}

/** Their material: what a draft may use and can't invent. */
function voiceMaterial(vp: VoicePackInput): string[] {
  const out: string[] = [];
  const beliefs = (vp.beliefs ?? []).filter(nonEmpty);
  if (beliefs.length) {
    out.push("What they believe (their point of view; argue from it, never against it):");
    beliefs.forEach((b) => out.push(`  - ${b.trim()}`));
  }
  const stories = (vp.stories ?? []).filter((s) => nonEmpty(s?.body));
  if (stories.length) {
    out.push("Stories they tell. Use one when it fits; keep its facts exactly as told:");
    stories.forEach((s) => out.push(`  - ${s.title.trim()}: ${s.body.trim()}${nonEmpty(s.lesson) ? ` (shows: ${s.lesson!.trim()})` : ""}`));
  }
  const proofs = (vp.proofs ?? []).filter((p) => nonEmpty(p?.claim));
  if (proofs.length) {
    out.push("Facts they can stand behind. These are the ONLY numbers, results and client details a draft may use:");
    proofs.forEach((p) => out.push(`  - ${p.claim.trim()}${nonEmpty(p.source) ? ` [${p.source!.trim()}]` : ""}`));
  }
  return out;
}

/** red-pen.md: the personal edit pass. */
function voiceRedPen(vp: VoicePackInput): string[] {
  const out: string[] = [];
  if ((vp.neverWords ?? []).length) out.push(`Never use: ${vp.neverWords!.join(", ")}`);
  if ((vp.exceptions ?? []).length)
    out.push(`Their own habits that beat the usual anti-AI rules: ${vp.exceptions!.join("; ")}`);
  if ((vp.mustHaves ?? []).length) out.push(`Every piece has: ${vp.mustHaves!.join(", ")}`);
  const sc = (vp.selfCheck ?? []).filter(nonEmpty);
  if (sc.length) {
    out.push("Before you finish, check (rewrite any line that fails):");
    sc.forEach((q, i) => out.push(`  ${i + 1}. ${q.trim()}`));
  }
  return out;
}

/**
 * The VOICE section, loaded per task in the spec's order (01 §3, 07):
 *   write    VOICE → guardrails → mechanics → platform → contexts → samples → identity
 *   rewrite  VOICE → mechanics → red pen → samples
 *   check    VOICE → guardrails → mechanics → red pen
 *   reply    VOICE → contexts → red pen
 * A writer also gets the red pen beside the guardrails (never-words are rules,
 * not style) and their material (stories, facts) after who they are.
 */
function serializeVoicePack(vp: VoicePackInput, platform: PlatformInput | null | undefined, task: ContextTask): string[] {
  switch (task) {
    case "rewrite":
      return [...voiceCore(vp), ...voiceMechanics(vp), ...voiceRedPen(vp), ...voiceSamples(vp)];
    case "check":
      return [...voiceCore(vp), ...voiceGuardrails(vp), ...voiceMechanics(vp), ...voiceAspiration(vp), ...voiceRedPen(vp)];
    case "reply":
      return [...voiceCore(vp), ...voiceContext(vp, platform), ...voiceRedPen(vp)];
    default:
      return [
        ...voiceCore(vp), ...voiceGuardrails(vp), ...voiceRedPen(vp), ...voiceMechanics(vp),
        ...voiceContext(vp, platform), ...voiceSamples(vp), ...voiceIdentity(vp), ...voiceMaterial(vp),
      ];
  }
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
  const pillars = (bp.pillars ?? []).filter((p) => nonEmpty(p?.name));
  if (pillars.length) {
    lines.push("Content pillars:");
    for (const p of pillars) lines.push(`  - ${p.name.trim()}${nonEmpty(p.description) ? `: ${p.description!.trim()}` : ""}`);
  }
  const answers = (bp.strategyAnswers ?? []).filter((a) => nonEmpty(a?.answer));
  if (answers.length) {
    lines.push("Strategy answers:");
    for (const a of answers) lines.push(`${a.key}: ${a.answer.trim()}`);
  }
  if (nonEmpty(bp.offersSummary)) lines.push(`Offers: ${bp.offersSummary!.trim()}`);
  const offers = (bp.offers ?? []).filter((o) => nonEmpty(o?.name));
  if (offers.length) {
    lines.push("What they sell (name the offer only where the piece asks for something):");
    for (const o of offers) {
      const bits = [nonEmpty(o.format) ? o.format!.trim() : "", nonEmpty(o.promise) ? o.promise!.trim() : ""].filter(Boolean);
      lines.push(`  - ${o.name.trim()}${bits.length ? `: ${bits.join(". ")}` : ""}`);
    }
  }

  if (input.voicePack) lines.push("", ...serializeVoicePack(input.voicePack, input.platform, input.task ?? "write"));
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
    if (input.platform) lines.push(...serializePlatform(input.platform));
  }

  lines.push("", "## VISUAL IDENTITY");
  if ((vi.palette ?? []).length) lines.push(`Palette: ${vi.palette!.join(", ")}`);
  if ((vi.fonts ?? []).length) lines.push(`Fonts: ${vi.fonts!.join(", ")}`);
  if (nonEmpty(vi.imageStyleNotes)) lines.push(`Image style: ${vi.imageStyleNotes!.trim()}`);
  for (const l of vi.coreLines ?? []) lines.push(l);
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
