/**
 * The Voice Pack as the spec's eight files (01 §2, the templates in 02):
 * VOICE.md, identity.md, guardrails.md, mechanics.md, contexts.md,
 * red-pen.md, samples.md and voice.json. The app edits the pack as cards;
 * this is the same pack, downloadable, so a person can open and read their own
 * voice the way the spec intended.
 *
 * Pure. Private writing is counted, never included: samples.md lists public
 * pieces only and says how many private ones were measured.
 */
import { deriveHardRules, deriveSelfCheck } from "./derive";
import { mechanicsLines, mustHaveLabel } from "./context";
import { DIAL_KEYS, DIAL_LABELS, LANGUAGES, type VoicePack, type VoiceSample } from "./types";
import { PLATFORM_RULES } from "./platforms";

export const VOICE_FILES = [
  "VOICE.md", "identity.md", "guardrails.md", "mechanics.md", "contexts.md", "red-pen.md", "samples.md", "voice.json",
] as const;
export type VoiceFile = (typeof VOICE_FILES)[number];

const tag = (t?: { source: string; confidence: string; count?: number }) =>
  t ? ` [${t.source}${t.confidence === "measured" ? ` · measured across ${t.count ?? 0}` : t.confidence === "aspiration" ? " · aspiration" : ""}]` : "";
const or = (v: string | undefined | null, empty = "_Not answered yet._") => (v && v.trim() ? v.trim() : empty);
const label = (k: string) => PLATFORM_RULES[k]?.label ?? k;

const QUADRANTS: Record<string, string> = {
  reserved_expert: "Reserved Expert", dynamic_leader: "Dynamic Leader", friendly_guide: "Friendly Guide", enthusiastic_friend: "Enthusiastic Friend",
};

function voiceMd(p: VoicePack): string {
  return [
    `# VOICE.md · ${p.displayName}`,
    "",
    `**Voice in one line:** ${or(p.voiceLine)}`,
    "",
    "## Load order",
    "| Task | Load, in order |",
    "|---|---|",
    "| Write anything | VOICE → guardrails → mechanics → platform rules → contexts (that platform) → samples (that platform first) → identity |",
    "| Rewrite / edit | VOICE → mechanics → red-pen → samples |",
    "| Voice check | VOICE → guardrails → mechanics → red-pen |",
    "| Short reply / comment | VOICE → contexts (channel) → red-pen |",
    "",
    "## Three hard rules",
    ...deriveHardRules(p).map((r, i) => `${i + 1}. ${r}`),
    "",
  ].join("\n");
}

function identityMd(p: VoicePack): string {
  const id = p.identity;
  const dials = id.dials?.value ?? {};
  const answers = id.answers ?? {};
  const pick = (prefix: string) => Object.entries(answers).filter(([k]) => k.startsWith(`${prefix} · `)).map(([k, v]) => `- ${k.slice(prefix.length + 3)}: ${v}`);
  return [
    "# identity.md · who is speaking",
    "",
    `## What they do, in their words${tag(id.voiceParagraph)}`,
    or(id.voiceParagraph?.value),
    "",
    `## Persona roles${tag(id.personaRoles)}`,
    or((id.personaRoles?.value ?? []).join("; ")),
    "",
    `## Four personality words${tag(id.personalityWords)}`,
    "| Word | What it means for them on the page |",
    "|---|---|",
    ...((id.personalityWords?.value ?? []).map((w) => `| ${w.word} | ${w.meaning || "_to confirm_"} |`)),
    "",
    `## Dials (1–10)${tag(id.dials)}`,
    DIAL_KEYS.filter((k) => dials[k] != null).map((k) => `${DIAL_LABELS[k][0]} ${dials[k]} ↔ ${DIAL_LABELS[k][1]}`).join(" · ") || "_Not set yet._",
    `Quadrant: ${id.quadrant?.value ? QUADRANTS[id.quadrant.value] : "_not set_"}${id.quadrant?.confidence === "aspiration" ? ` (where they want to be; today: ${QUADRANTS[String(id.quadrant.measuredValue)] ?? "?"})` : ""}`,
    "",
    "## Guarded vs unguarded",
    `- In public: ${or(id.guarded?.value)}`,
    `- Off-guard: ${or(id.unguarded?.value)}`,
    "",
    "## Feeling targets",
    `- 30-second skim: ${or(id.feeling30s?.value)}`,
    `- 5-minute read: ${or(id.feeling5m?.value)}`,
    `- 20-minute conversation: ${or(id.feeling20m?.value)}`,
    "",
    "## Who they talk to",
    or(id.reader?.value),
    "",
    "## What the voice carries",
    or(id.carries?.value),
    "",
    "## Where the voice comes from",
    or(id.roots?.value),
    "",
    "## Humour",
    or(id.humour?.value),
    "",
    "## Language & culture",
    id.languages?.value
      ? `${LANGUAGES.find((l) => l.key === id.languages!.value.primary)?.label ?? id.languages.value.primary}${id.languages.value.also.length ? `, mixing in ${id.languages.value.also.map((k) => LANGUAGES.find((l) => l.key === k)?.label ?? k).join(", ")}` : ""}${id.languages.value.when ? ` (${id.languages.value.when})` : ""}`
      : or(id.language?.value),
    "",
    "## How their tone shifts",
    ...(pick("F3").length ? pick("F3") : ["_Not answered yet._"]),
    "",
  ].join("\n");
}

function guardrailsMd(p: VoicePack): string {
  const out = ["# guardrails.md · the overrides", "", "These beat every other instruction. Break one and the output is wrong, however well written.", ""];
  const rails = [
    ...p.guardrails,
    { id: "facts", name: "Facts", rule: "Never invent a fact, client, number, credential, date or quote.", why: "One wrong fact costs more trust than a hundred good posts earn.", instead: "Use a [placeholder] and flag it.", source: "derived" as const },
  ];
  rails.forEach((g, i) => {
    out.push(`## ${i + 1}. ${g.name}`, `- **Rule:** ${g.rule}`, `- **Why:** ${g.why || "_in their words, to add_"}`, `- **Instead:** ${g.instead || "_to add_"}`, "");
  });
  if (p.identity.influences?.value?.avoid.length) out.push(`**Must never sound like:** ${p.identity.influences.value.avoid.join("; ")}`, "");
  return out.join("\n");
}

function mechanicsMd(p: VoicePack): string {
  const m = p.mechanics;
  const s = p.corpusStats;
  const bank = (xs: { pattern: string; example: string }[] | undefined) => (xs?.length ? ["| Pattern | Example |", "|---|---|", ...xs.map((x) => `| ${x.pattern} | "${x.example.replace(/\|/g, "/")}" |`)] : ["_None measured yet._"]);
  return [
    "# mechanics.md · the measured fingerprint",
    `Corpus: ${s.pieces} pieces, ${s.sentences} sentences${s.from ? `, ${s.from.slice(0, 10)} to ${(s.to ?? "").slice(0, 10)}` : ""}, ${s.channels.map(label).join(", ") || "no channels yet"}.`,
    "",
    "## In plain words",
    ...(mechanicsLines(p).map((l) => `- ${l}`)),
    "",
    "## Length by format",
    "| Format | Range (words) |",
    "|---|---|",
    ...Object.entries(m.lengthByFormat?.value ?? {}).map(([k, [lo, hi]]) => `| ${label(k)} | ${lo}–${hi} |`),
    "",
    "## Openers (real, verbatim)",
    ...bank(m.openers?.value),
    "",
    "## Closers (real, verbatim)",
    ...bank(m.closers?.value),
    "",
    "## Lexicon",
    `- Reaches for: ${(m.lexicon?.value ?? []).join(", ") || "_none measured yet_"}`,
    "",
    "## Signature phrases (max ONE per piece, rotate, never the same opener twice in a row)",
    ...([...new Set([...(p.onboarding.patterns?.kept ?? []), ...p.index.signaturePhrases])].map((x) => `- ${x}`)),
    "",
  ].join("\n");
}

function contextsMd(p: VoicePack): string {
  const out = [`# contexts.md · how ${p.displayName} writes on each platform`, "", "Same person, different rooms. Measured blocks come from at least five real pieces on that platform; inferred ones keep close to the general voice.", ""];
  const blocks = Object.values(p.contexts);
  if (!blocks.length) out.push("_No platforms yet._");
  for (const c of blocks) {
    out.push(`## ${label(c.channel)}  [${c.tag}${c.pieceCount ? ` · ${c.pieceCount} pieces` : ""}]`);
    const rows: [string, string | undefined][] = [
      ["Register", c.register], ["First line", c.firstLine], ["Structure", c.structure], ["Length", c.length],
      ["Opens", c.opener], ["Closes with", c.closer], ["Notes", c.notes], ["Differs from default voice by", c.differsBy],
    ];
    const filled = rows.filter(([, v]) => v);
    out.push(...(filled.length ? filled.map(([k, v]) => `- ${k}: ${v}`) : ["- Falls back to the general voice until there are five pieces from here."]), "");
  }
  const so = Object.entries(p.identity.answers ?? {}).filter(([k]) => k.startsWith("F5 · "));
  if (so.length) out.push("## Sign-offs", ...so.map(([k, v]) => `- ${k.slice(5)}: ${v}`), "");
  return out.join("\n");
}

function redPenMd(p: VoicePack): string {
  const never = p.index.neverWords.length ? p.index.neverWords : (p.redPen.neverList?.value ?? []);
  const checks = p.redPen.selfCheck?.value?.length ? p.redPen.selfCheck.value : deriveSelfCheck(p);
  return [
    "# red-pen.md · the edit pass",
    "Run after every draft. Platform anti-AI rules apply first. This file holds the personal layer.",
    "",
    "## Never-list (personal)",
    never.join(", ") || "_None yet._",
    "",
    "## Exceptions to platform rules",
    ...((p.redPen.exceptions?.value ?? []).map((e) => `- ${e.item}: ${e.evidence}`)),
    ...(p.redPen.exceptions?.value?.length ? [] : ["_None proven yet._"]),
    "",
    "## Must-haves",
    ...((p.redPen.mustHaves?.value ?? p.index.mustHaves).map((m) => `- ${mustHaveLabel(m)}`)),
    "",
    "## Self-check",
    ...checks.map((q, i) => `${i + 1}. ${q}`),
    "",
  ].join("\n");
}

function samplesMd(p: VoicePack, samples: VoiceSample[]): string {
  const pub = samples.filter((s) => s.visibility === "public" && !s.excluded);
  const priv = samples.filter((s) => s.visibility === "private" && !s.excluded).length;
  const bench = pub.filter((s) => s.kind === "benchmark");
  const unguarded = pub.filter((s) => s.kind === "unguarded");
  const corpus = pub.filter((s) => s.kind !== "benchmark" && s.kind !== "unguarded");
  const notes = p.onboarding.benchmarkNotes ?? {};
  const a = p.onboarding.antiSample;
  return [
    "# samples.md · the few-shot gold",
    "Match rhythm and word choice. Never copy sentences.",
    "",
    "## Benchmarks (their picks, annotated)",
    ...(bench.length ? bench.flatMap((s, i) => [`### B${i + 1} · ${label(s.channel)}`, s.body, "", `*Why it's them:* ${notes[s.id]?.note || "_to confirm_"}`, ""]) : ["_Not picked yet._", ""]),
    "## Anti-sample",
    ...(a ? [`**Almost them, but wrong:** ${a.text}`, `**What's off:** ${a.off}`, ...(a.fixed ? [`**Fixed:** ${a.fixed}`] : []), ""] : ["_Not chosen yet._", ""]),
    `## Corpus (${corpus.length} public pieces, unedited${priv ? `; ${priv} private pieces measured but not included here` : ""})`,
    ...corpus.flatMap((s) => [`### ${label(s.channel)}${s.publishedAt ? ` · ${s.publishedAt.slice(0, 10)}` : ""}`, s.body, ""]),
    "## Unguarded corpus (comments, replies, voice notes)",
    ...(unguarded.length ? unguarded.flatMap((s) => [s.body, ""]) : ["_None yet._", ""]),
  ].join("\n");
}

function voiceJson(p: VoicePack): string {
  const pr = p.index.punctuation;
  const rule = (k: keyof typeof pr) => ({ allowed: pr[k]?.allowed ?? null, per_post_target: pr[k]?.perPostTarget ?? null, per_post_max: pr[k]?.perPostMax ?? null });
  return JSON.stringify({
    version: p.version,
    user_id: p.userId,
    punctuation: { em_dash: rule("emDash"), ellipsis: rule("ellipsis"), exclamation: rule("exclamation"), semicolon: rule("semicolon"), emoji: rule("emoji") },
    sentence_length: { mean: p.index.sentenceLength.mean ?? null, median: p.index.sentenceLength.median ?? null, short_pct: p.index.sentenceLength.shortPct ?? null, long_pct: p.index.sentenceLength.longPct ?? null },
    never_words: p.index.neverWords,
    allowed_exceptions: p.index.allowedExceptions,
    must_haves: p.index.mustHaves,
    dials: p.index.dials,
    length_by_format: p.index.lengthByFormat,
    signature_phrases: p.index.signaturePhrases,
    signature_phrase_max_per_piece: p.index.signaturePhraseMaxPerPiece,
    last_openers: p.index.lastOpeners,
  }, null, 2);
}

export function exportVoiceFile(file: VoiceFile, pack: VoicePack, samples: VoiceSample[]): string {
  switch (file) {
    case "VOICE.md": return voiceMd(pack);
    case "identity.md": return identityMd(pack);
    case "guardrails.md": return guardrailsMd(pack);
    case "mechanics.md": return mechanicsMd(pack);
    case "contexts.md": return contextsMd(pack);
    case "red-pen.md": return redPenMd(pack);
    case "samples.md": return samplesMd(pack, samples);
    case "voice.json": return voiceJson(pack);
  }
}

/** All eight in one Markdown file, each under its own heading. */
export function exportVoicePack(pack: VoicePack, samples: VoiceSample[]): string {
  return [
    `# ${pack.displayName} · Voice Pack (version ${pack.version})`,
    "",
    ...VOICE_FILES.flatMap((f) => [`<!-- ${f} -->`, f === "voice.json" ? `\`\`\`json\n${voiceJson(pack)}\n\`\`\`` : exportVoiceFile(f, pack, samples), "", "---", ""]),
  ].join("\n");
}
