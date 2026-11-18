/**
 * What the code does with the model's line findings (the judgement half of
 * the check, lib/ai/tasks voiceJudge) before a person sees them. Pure: no I/O.
 *
 * A model's finding is a suggestion; these are the parts that are checked
 * rather than trusted (2026-11-17 QA):
 *
 *   - the line must be in the draft, or it can't be shown or replaced;
 *   - the words the reason is about (`quote`) must be in that line, or the
 *     reason is about something that isn't there ("missing contraction on
 *     can't" for a line without it) and the finding is dropped;
 *   - a fix that still carries a phrase the same check flagged (a never-word,
 *     a stock phrase) is not a fix: it is dropped and the finding stays
 *     without one;
 *   - an empty fix on a line that drifts means "cut this line".
 *
 * And the score follows the findings: a line marked off brand caps the score
 * under "On brand", the same way a must-fix finding from the code does.
 */
import type { JudgeResult, LineFinding } from "@/lib/ai/tasks";
import { bandFor, MUST_FIX_CAP, type VoiceCheckResult, type VoiceIssue } from "./check";
import { ANTI_AI_PHRASES } from "./platforms";
import { CLAIM_MESSAGE, unsupportedClaims, type UnsupportedClaim } from "./facts";
import type { VoiceIndex } from "./types";

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** The phrase as a whole-word, case-blind pattern (a phrase ending in punctuation has no word edge there). */
function phraseRe(phrase: string): RegExp {
  const p = phrase.trim();
  const edge = (c: string) => (WORD_CHAR.test(c) ? "\\b" : "");
  return new RegExp(`${edge(p[0])}${escapeRe(p)}${edge(p[p.length - 1])}`, "i");
}

/**
 * The phrases the deterministic check flags in this text: their never-words
 * and the watch-list phrases they have not proven as their own. A fix may not
 * contain any of them, and the judge is told so.
 */
export function flaggedPhrases(text: string, index: Pick<VoiceIndex, "neverWords" | "allowedExceptions">): string[] {
  const exceptions = index.allowedExceptions.map((e) => e.toLowerCase());
  const watch = ANTI_AI_PHRASES.filter((p) => !exceptions.includes(p));
  const never = index.neverWords.map((w) => w.trim()).filter(Boolean);
  return [...new Set([...never, ...watch])].filter((p) => phraseRe(p).test(text));
}

/** Any phrase from `banned` that is in the text. Used on a fix, against everything the check would flag. */
export function carriedOver(text: string, banned: string[]): string[] {
  return banned.filter((p) => p.trim() && phraseRe(p).test(text));
}

/**
 * Keep the findings a person can act on, as described at the top of the file.
 * `banned` is every phrase a fix may not contain: the person's never-list and
 * the watch-list (not only the ones in this draft, so a fix can't swap one
 * stock phrase for another).
 */
/**
 * A fix that states a fact the brand context does not back up, where the line
 * it replaces did not already state one: that is an invented fact, not a fix
 * (lib/voice/facts). Off when there is no grounding to check against.
 */
function invents(fix: string, line: string, grounding?: string): boolean {
  if (grounding == null) return false;
  return unsupportedClaims(fix, grounding).length > unsupportedClaims(line, grounding).length;
}

export function vetFindings(draft: string, findings: JudgeResult["findings"], banned: string[], grounding?: string): LineFinding[] {
  const whole = squash(draft);
  const out: LineFinding[] = [];
  const seen = new Set<string>();
  for (const f of findings) {
    const line = f.line.trim();
    if (!line || !whole.includes(squash(line)) || seen.has(line)) continue;
    const quote = f.quote.trim().replace(/^["“'‘]+|["”'’]+$/g, "");
    // The reason has to be about words that are there.
    if (f.verdict !== "on" && (!quote || !squash(line).toLowerCase().includes(squash(quote).toLowerCase()))) continue;
    seen.add(line);
    if (f.verdict === "on") {
      out.push({ ...f, line, quote, fix: "", remove: false });
      continue;
    }
    let fix = f.fix.trim().replace(/^["“]([\s\S]*)["”]$/, "$1").trim();
    const remove = fix === "";
    // Not a fix if it changes nothing, or keeps what was flagged.
    if (!remove && (squash(fix) === squash(line) || carriedOver(fix, banned).length > 0 || invents(fix, line, grounding))) fix = "";
    out.push({ ...f, line, quote, fix, remove });
  }
  return out;
}

/**
 * The line as a pattern that finds it in the piece whatever the spacing: a
 * model copies a line with one space where the piece has a line break, and
 * the finding should still land on it.
 */
function lineRe(line: string): RegExp | null {
  const words = line.trim().split(/\s+/).filter(Boolean);
  return words.length ? new RegExp(words.map(escapeRe).join("\\s+")) : null;
}

/** Whether the line a finding quotes is (still) in the text. */
export const hasLine = (text: string, line: string): boolean => lineRe(line)?.test(text) ?? false;

/**
 * The text with one finding applied: the line replaced by its fix, or cut
 * (with the blank line it leaves). Null when the line is no longer there.
 */
export function applyFinding(text: string, f: Pick<LineFinding, "line" | "fix" | "remove">): string | null {
  const at = lineRe(f.line);
  if (!at || !at.test(text)) return null;
  if (!f.remove) return f.fix ? text.replace(at, () => f.fix) : null;
  return text
    .replace(at, "\u0000")
    // A line cut from between two others takes one of its line breaks with it.
    .replace(/\n?[ \t]*\u0000[ \t]*\n?/, (m) => (m.includes("\n") ? "\n" : " "))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * The verdict once the line findings are in. The code's score stands; each
 * line that is off brand takes a little more, and any of them caps it under
 * "On brand", so a piece is never "On brand" beside a list of line clashes.
 */
export function withLineFindings<T extends VoiceCheckResult>(result: T, lines: Pick<LineFinding, "verdict">[] | null | undefined): T {
  const off = (lines ?? []).filter((l) => l.verdict === "off").length;
  const drift = (lines ?? []).filter((l) => l.verdict === "drift").length;
  if (!off && !drift) return result;
  let score = Math.max(0, result.score - Math.min(30, off * 6 + drift * 3));
  if (off > 0 || drift >= 3) score = Math.min(score, MUST_FIX_CAP);
  return { ...result, score, band: bandFor(score) };
}

/** Whether the list holds anything that must be fixed before the piece can be on brand. */
export const hasMustFix = (issues: VoiceIssue[]): boolean => issues.some((i) => i.mustFix);

const normalForMatch = (s: string): string =>
  s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/**
 * The unsupported claims a REWRITE adds: what the new text states that the old
 * text did not already state. A sentence the rewrite keeps from the piece is
 * not new (the piece was already there), so it does not block the rewrite.
 * Grounding is the brand context plus the piece's topic (lib/voice/facts).
 */
export function addedClaims(before: string, after: string, grounding: string): UnsupportedClaim[] {
  const was = normalForMatch(before);
  const beforeDigits = digitsIn(before);
  return unsupportedClaims(after, grounding).filter((c) => !isOld(c, was, beforeDigits));
}

const digitsIn = (s: string): Set<string> => new Set([...s.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, "")));

/**
 * Whether a claim the rewrite states was already in the piece: a number is old
 * when every figure in it was in the piece (a reworded sentence keeps its figure);
 * anything else is old when its sentence is in the piece as written.
 */
function isOld(c: UnsupportedClaim, was: string, beforeDigits: Set<string>): boolean {
  if (c.kind === "number") {
    const figures = [...digitsIn(c.excerpt)];
    if (figures.length && figures.every((f) => beforeDigits.has(f))) return true;
  }
  // An excerpt cut for length ends in an ellipsis; the part before it is still the sentence.
  return was.includes(normalForMatch(c.excerpt.replace(/…$/, "")));
}

/** What the person is told when a rewrite is not saved: nothing changed, what it adds, what to do. */
export function blockedRewriteMessage(claims: UnsupportedClaim[]): string {
  const shown = claims.slice(0, 3).map((c) => `“${c.excerpt}”`).join(" ");
  const more = claims.length > 3 ? ` and ${claims.length - 3} more` : "";
  const why = claims[0] ? CLAIM_MESSAGE[claims[0].kind] : "";
  return `Nothing was changed. The rewrite adds ${shown}${more}. ${why} Then ask again.`.replace(/ +/g, " ");
}

/**
 * A rewrite that adds a claim the brand context does not back up. Thrown
 * before anything is saved: the piece keeps its old text, and `rewrite` holds
 * what the model wrote so the caller can show it.
 */
export class UnsupportedRewriteError extends Error {
  claims: UnsupportedClaim[];
  rewrite: string;
  constructor(claims: UnsupportedClaim[], rewrite: string) {
    super(blockedRewriteMessage(claims));
    this.name = "UnsupportedRewriteError";
    this.claims = claims;
    this.rewrite = rewrite;
  }
}
