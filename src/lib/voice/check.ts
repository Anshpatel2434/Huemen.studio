/**
 * The deterministic half of the voice check (client spec 01 §5).
 *
 * No model call. Code only, instant, and always right about the things code can
 * be right about: banned words, punctuation the person does not use, length,
 * sentence-length distribution, signature-phrase rationing, a repeated opener,
 * and the platform's hard limits.
 *
 * Judgement — does this SOUND like them, does it carry their one idea — is the
 * model's job and lives elsewhere. Keeping the two apart means the cheap check
 * runs on every keystroke and the expensive one runs when it is worth it.
 *
 * It WARNS. It does not block (question 23): blocking someone's own writing on
 * a machine score is how you lose the person whose voice it is.
 *
 * Pure — no I/O.
 */
import { measurePiece, words } from "./measure";
import { ANTI_AI_PHRASES, platformRule } from "./platforms";
import type { PunctuationRates, VoiceIndex } from "./types";

export type IssueSeverity = "error" | "warning" | "note";

export interface VoiceIssue {
  code: string;
  severity: IssueSeverity;
  /** Written to the user, in their terms. Not a stack trace. */
  message: string;
  /** The offending text, where there is one, so the UI can highlight it. */
  excerpt?: string;
}

/**
 * The three bands from design system §15.3. Publishing is never blocked in any
 * of them — it is their brand, not ours — but the band decides what the UI
 * leads with: findings collapsed, findings open, or the rewrite made primary.
 *
 * The 85 and 60 thresholds are the document's own starting point, not a
 * finding. They are meant to be re-set from real check data (§18).
 */
export type ScoreBand = "on_brand" | "drifting" | "off_brand";

export function bandFor(score: number): ScoreBand {
  if (score >= 85) return "on_brand";
  if (score >= 60) return "drifting";
  return "off_brand";
}

export const BAND_LABEL: Record<ScoreBand, string> = {
  on_brand: "On brand",
  drifting: "Drifting",
  off_brand: "Off brand",
};

export interface VoiceCheckResult {
  /** 0–100. Starts at 100; every issue costs. */
  score: number;
  band: ScoreBand;
  issues: VoiceIssue[];
}

export interface CheckOptions {
  /** Platform key from lib/voice/platforms, e.g. "linkedin". */
  channel?: string;
  /** The openers of the last few published pieces, to catch repetition. */
  recentOpeners?: string[];
  /**
   * How many pieces of their own writing we measured, and how often each
   * watch-list phrase appears in it. A finding cites their corpus rather than
   * a generic rule, which is the whole difference between this and a grammar
   * checker (design system §15.4).
   */
  corpusPieces?: number;
  corpusUses?: Record<string, number>;
  /** Their own public writing, to catch a draft that copies it word for word. */
  corpusTexts?: string[];
}

/** Eight words in a row matching their writing is a copy, not a rhythm. */
const COPY_RUN = 8;

/** The first run of COPY_RUN+ words the draft shares with any corpus text, or null. */
export function copiedRun(draft: string, corpus: string[]): string | null {
  if (!corpus.length) return null;
  const norm = (s: string) => words(s.toLowerCase());
  const grams = new Set<string>();
  for (const body of corpus) {
    const w = norm(body);
    for (let i = 0; i + COPY_RUN <= w.length; i++) grams.add(w.slice(i, i + COPY_RUN).join(" "));
  }
  const d = norm(draft);
  for (let i = 0; i + COPY_RUN <= d.length; i++) {
    if (grams.has(d.slice(i, i + COPY_RUN).join(" "))) return words(draft).slice(i, i + COPY_RUN + 4).join(" ");
  }
  return null;
}

/**
 * What spec 07's last column says the check tests, per platform. Hard limits
 * are errors; norms are notes.
 */
function platformIssues(text: string, m: ReturnType<typeof measurePiece>, channel?: string): VoiceIssue[] {
  const rule = platformRule(channel);
  if (!rule) return [];
  const out: VoiceIssue[] = [];
  const lines = text.split("\n");
  const nonEmpty = lines.filter((l) => l.trim());

  // X threads: each numbered part has its own limit.
  const threadParts = rule.key === "x" ? text.split(/\n(?=\s*\d+\/)/).filter((p) => p.trim()) : [];
  if (threadParts.length > 1) {
    threadParts.forEach((p, i) => {
      if (rule.maxChars != null && p.trim().length > rule.maxChars)
        out.push({ code: "platform_limit", severity: "error", message: `Part ${i + 1} of the thread is ${p.trim().length} characters. X stops at ${rule.maxChars}.` });
    });
  } else if (rule.maxChars != null && text.length > rule.maxChars) {
    out.push({ code: "platform_limit", severity: "error", message: `${text.length} characters. ${rule.label} stops at ${rule.maxChars}.` });
  }

  if (rule.maxHashtags != null && m.hashtags.length > rule.maxHashtags) {
    out.push({
      code: "platform_hashtags",
      severity: "warning",
      message: rule.maxHashtags === 0 ? `${rule.label} doesn't use hashtags.` : `${m.hashtags.length} hashtags. ${rule.label} takes ${rule.maxHashtags}.`,
    });
  }

  // The hook has to land before "see more": inside the visible characters AND lines.
  if (rule.visibleChars != null && text.length > rule.visibleChars) {
    const byLines = rule.visibleLines ? nonEmpty.slice(0, rule.visibleLines).join("\n") : text;
    const hook = (byLines.length < rule.visibleChars ? byLines : text.slice(0, rule.visibleChars));
    if (!/[.!?:]/.test(hook) && !(rule.visibleLines && nonEmpty.length > 1 && nonEmpty[0].length <= rule.visibleChars)) {
      out.push({ code: "weak_hook", severity: "note", message: `Nothing lands before the "see more" cut.`, excerpt: hook });
    }
  }

  switch (rule.key) {
    case "linkedin":
      if (text.length > 500 && m.paragraphCount <= 1)
        out.push({ code: "platform_breaks", severity: "note", message: "One block of text. LinkedIn reads in short paragraphs with white space." });
      break;
    case "newsletter":
      if (m.wordCount > 400 && !lines.some((l) => /^#{1,3}\s|^\*\*.+\*\*$/.test(l.trim())))
        out.push({ code: "platform_structure", severity: "note", message: "No subheads. A longer piece reads better in scannable sections." });
      break;
    case "email": {
      const subject = (nonEmpty[0] ?? "").replace(/^subject:\s*/i, "");
      const [lo, hi] = rule.subjectChars ?? [40, 60];
      if (subject && (subject.length > hi || subject.length < Math.min(lo, 12)))
        out.push({ code: "email_subject", severity: "note", message: `The subject is ${subject.length} characters. Inboxes show about ${lo}–${hi}.`, excerpt: subject });
      const asks = (text.match(/\?/g) ?? []).length + (text.match(/\b(could you|can you|would you|please)\b/gi) ?? []).length;
      if (asks > 2) out.push({ code: "email_asks", severity: "note", message: "Several asks in one email. One clear next step works best." });
      break;
    }
    case "whatsapp":
      if (/^#{1,6}\s/m.test(text) || /\*\*[^*]+\*\*/.test(text) || /\[[^\]]+\]\([^)]+\)/.test(text))
        out.push({ code: "platform_format", severity: "warning", message: "WhatsApp only understands *bold*, _italic_ and ~strike~. Headers, **double stars** and links in brackets show as raw symbols." });
      break;
    case "slack":
      if (/^#{1,6}\s/m.test(text) || /\*\*[^*]+\*\*/.test(text))
        out.push({ code: "platform_format", severity: "warning", message: "Slack shows markdown headers and **double stars** as raw symbols. Use *bold*." });
      break;
    case "spoken":
      if (/[()[\]{}]|\s\/\s|^\s*[-*•]\s/m.test(text))
        out.push({ code: "spoken_visual", severity: "warning", message: "Brackets, slashes and bullets don't read aloud. Say it the way you'd say it." });
      break;
  }
  return out;
}

const COST: Record<IssueSeverity, number> = { error: 20, warning: 10, note: 4 };

/** Punctuation marks the check can speak about, with the name the user uses. */
const MARK_NAMES: Partial<Record<keyof PunctuationRates, string>> = {
  emDash: "em dash",
  ellipsis: "ellipsis",
  exclamation: "exclamation mark",
  semicolon: "semicolon",
  emoji: "emoji",
  parentheses: "parentheses",
};

function findPhrase(haystack: string, needle: string): string | undefined {
  const i = haystack.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return undefined;
  return haystack.slice(Math.max(0, i - 30), i + needle.length + 30).trim();
}

export function checkDraft(
  draft: string,
  index: VoiceIndex,
  opts: CheckOptions = {},
): VoiceCheckResult {
  const issues: VoiceIssue[] = [];
  const text = draft.trim();
  if (!text)
    return {
      score: 0,
      band: "off_brand",
      issues: [{ code: "empty", severity: "error", message: "There is nothing to check yet." }],
    };

  const m = measurePiece(text);
  const lower = text.toLowerCase();

  // 1. The person's own never-list. Their rule, so it outranks ours.
  for (const w of index.neverWords) {
    const needle = w.trim();
    if (!needle) continue;
    if (new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) {
      issues.push({
        code: "never_word",
        severity: "error",
        message: `"${needle}" is on your never-list.`,
        excerpt: findPhrase(text, needle),
      });
    }
  }

  // 2. The universal watch-list — unless this person has PROVEN the habit.
  //
  // The wording matters and is not a style choice. The design system (§16)
  // forbids the interface from telling someone their writing sounds like AI:
  // it is their name on the piece, and a machine's opinion of their quality is
  // not something we are in a position to offer. So a finding says what was
  // counted in THEIR corpus and leaves the judgement to them (§15.4).
  for (const phrase of ANTI_AI_PHRASES) {
    if (index.allowedExceptions.some((e) => e.toLowerCase() === phrase)) continue;
    if (lower.includes(phrase)) {
      const used = opts.corpusUses?.[phrase] ?? 0;
      const pieces = opts.corpusPieces ?? 0;
      issues.push({
        code: "watch_phrase",
        severity: "warning",
        message:
          pieces > 0
            ? `You have used "${phrase}" ${used} ${used === 1 ? "time" : "times"} in ${pieces} ${pieces === 1 ? "piece" : "pieces"}.`
            : `"${phrase}" is on the watch-list.`,
        excerpt: findPhrase(text, phrase),
      });
    }
  }

  // 3. Punctuation they do not use, and habits pushed past their own ceiling.
  for (const [key, rule] of Object.entries(index.punctuation) as [keyof PunctuationRates, VoiceIndex["punctuation"][keyof PunctuationRates]][]) {
    if (!rule) continue;
    const used = m.punctuation[key] ?? 0;
    const name = MARK_NAMES[key] ?? key;
    if (rule.allowed === false && used > 0) {
      issues.push({
        code: "punctuation_unused",
        severity: "warning",
        message: `You don't use the ${name}. This draft has ${used}.`,
      });
    } else if (rule.allowed && rule.perPostMax != null && used > rule.perPostMax) {
      issues.push({
        code: "punctuation_over",
        severity: "note",
        message: `${used} ${name}${used === 1 ? "" : "s"} — you normally stop at ${rule.perPostMax}.`,
      });
    }
  }

  // 4. Length, both their own range and the platform's hard limit.
  const range = opts.channel ? index.lengthByFormat[opts.channel] : undefined;
  if (range) {
    const [lo, hi] = range;
    if (m.wordCount < lo * 0.6)
      issues.push({ code: "too_short", severity: "note", message: `${m.wordCount} words. Yours usually run ${lo}–${hi}.` });
    if (m.wordCount > hi * 1.4)
      issues.push({ code: "too_long", severity: "note", message: `${m.wordCount} words. Yours usually run ${lo}–${hi}.` });
  }

  issues.push(...platformIssues(text, m, opts.channel));

  // 5. Sentence rhythm. Their distribution, not a general readability score:
  // the average, and how many very short and very long sentences they use.
  const target = index.sentenceLength;
  const lens = m.sentenceLengths;
  if (target?.mean && lens.length >= 3) {
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    if (Math.abs(avg - target.mean) > Math.max(5, target.mean * 0.5)) {
      issues.push({
        code: "rhythm",
        severity: "warning",
        message: `Sentences average ${Math.round(avg)} words. Yours average ${target.mean}.`,
      });
    } else if (lens.length >= 6) {
      const shortPct = (lens.filter((l) => l <= 4).length / lens.length) * 100;
      const longPct = (lens.filter((l) => l > 18).length / lens.length) * 100;
      if (target.shortPct != null && target.shortPct >= 10 && shortPct === 0)
        issues.push({ code: "rhythm_short", severity: "note", message: `No short sentences. About ${Math.round(target.shortPct)}% of yours are four words or fewer.` });
      if (target.longPct != null && longPct > target.longPct + 25)
        issues.push({ code: "rhythm_long", severity: "note", message: `${Math.round(longPct)}% of sentences run past eighteen words. Yours: about ${Math.round(target.longPct)}%.` });
    }
  }

  // 5b. Never a sentence lifted from their own writing (spec 06 §5): samples
  // teach rhythm, not text.
  const copied = copiedRun(text, opts.corpusTexts ?? []);
  if (copied) {
    issues.push({
      code: "copied",
      severity: "warning",
      message: "This line is word for word from something you've already written.",
      excerpt: copied,
    });
  }

  // 6. Signature phrases are rationed: one per piece, or they stop being yours.
  const usedSignatures = index.signaturePhrases.filter((p) => p && lower.includes(p.toLowerCase()));
  if (usedSignatures.length > index.signaturePhraseMaxPerPiece) {
    issues.push({
      code: "signature_overuse",
      severity: "warning",
      message: `${usedSignatures.length} of your signature phrases in one piece. Keep ${index.signaturePhraseMaxPerPiece}.`,
      excerpt: usedSignatures.join(" · "),
    });
  }

  // 7. The same opening as last time.
  const opener = m.firstLine.toLowerCase();
  const openerStart = words(opener).slice(0, 4).join(" ");
  if (
    openerStart &&
    (opts.recentOpeners ?? index.lastOpeners).some(
      (o) => words(o.toLowerCase()).slice(0, 4).join(" ") === openerStart,
    )
  ) {
    issues.push({
      code: "repeat_opener",
      severity: "note",
      message: "You opened a recent piece the same way.",
      excerpt: m.firstLine,
    });
  }

  // 8. The things every piece of theirs has.
  for (const must of index.mustHaves) {
    if (must === "closing_question" && !m.endsWithQuestion)
      issues.push({ code: "missing_must", severity: "note", message: "You usually end on a question." });
    if (must === "one_fragment" && !m.sentenceLengths.some((l) => l <= 3))
      issues.push({ code: "missing_must", severity: "note", message: "You usually drop in one very short line." });
  }

  const score = Math.max(
    0,
    issues.reduce((s, i) => s - COST[i.severity], 100),
  );
  return { score, band: bandFor(score), issues };
}
