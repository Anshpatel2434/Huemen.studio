/**
 * The voice core over time. Pure: the clock is always passed in.
 *
 *   coreState     the four training states of design system §15.2
 *   rescanDue     the 90-day invitation to re-measure (plan, Flow 4)
 *   diffPacks     what one saved version changed, in plain English
 *   prefill       a Core answer we already have, offered as a one-tap confirm
 */
import { DIAL_KEYS, DIAL_LABELS, type DialKey, type Onboarding, type VoicePack } from "./types";

// ---- §15.2: Empty → Ingesting → Learning → Trained -------------------------

export type CoreState = "empty" | "ingesting" | "learning" | "trained";

export const CORE_STATE_LABEL: Record<CoreState, string> = {
  empty: "Not started",
  ingesting: "Reading your writing",
  learning: "Building your core",
  trained: "Ready",
};

/**
 * A scan that started this long ago and never reported back is treated as over:
 * the request that ran it died. Without this a crashed scan would leave the
 * core "building" forever.
 */
export const SCAN_STALE_MS = 10 * 60 * 1000;

export type ScanState = NonNullable<Onboarding["scan"]>;

export function scanInProgress(scan: Onboarding["scan"], now: number): "ingesting" | "learning" | null {
  if (!scan || scan.state === "done") return null;
  return now - new Date(scan.at).getTime() < SCAN_STALE_MS ? scan.state : null;
}

/**
 * Files are read in the browser and sent one at a time, and every file that
 * lands refreshes `scan.at`. So "ingesting" with no file for this long means
 * the tab that was sending them closed or reloaded: the pieces that arrived
 * are saved but not yet measured, and the page should finish the job.
 */
export const INGEST_HEARTBEAT_MS = 20 * 1000;

export function ingestStalled(scan: Onboarding["scan"], now: number): boolean {
  return scan?.state === "ingesting" && now - new Date(scan.at).getTime() >= INGEST_HEARTBEAT_MS;
}

/**
 * The first piece is one model call, bounded by the request timeout
 * (AI_TEXT_TIMEOUT_MS, two minutes by default). Still "writing" well past that
 * means the request died, and the payoff screen offers to try again.
 */
export const FIRST_PIECE_STALE_MS = 3 * 60 * 1000;

export const firstPieceStale = (fp: Onboarding["firstPiece"], now: number): boolean =>
  !!fp && now - new Date(fp.at).getTime() >= FIRST_PIECE_STALE_MS;

/**
 * Trained is "ready, with a number" (§15.2): it says nothing about how high
 * the number is. Below 70% the card stays Trained but labels the core
 * provisional and offers more samples before a draft.
 */
export function coreState(pack: Pick<VoicePack, "corpusStats" | "onboarding">, now: number): CoreState {
  const running = scanInProgress(pack.onboarding.scan, now);
  if (running) return running;
  return pack.corpusStats.pieces === 0 ? "empty" : "trained";
}

// ---- the 90-day re-measure invitation --------------------------------------

export const RESCAN_AFTER_DAYS = 90;

/**
 * Invite a re-measure once 90 days have passed since the last one AND there is
 * new writing to learn from (approved pieces since then). Nothing new means
 * nothing to learn, so no nag.
 */
export function rescanDue(
  pack: Pick<VoicePack, "scannedAt" | "corpusStats">,
  approvedSinceScan: number,
  now: number,
): { due: boolean; days: number } {
  if (!pack.scannedAt || pack.corpusStats.pieces === 0) return { due: false, days: 0 };
  const days = Math.floor((now - new Date(pack.scannedAt).getTime()) / 86_400_000);
  return { due: days >= RESCAN_AFTER_DAYS && approvedSinceScan > 0, days };
}

// ---- version diffs -----------------------------------------------------------

type Snap = Partial<VoicePack>;

const list = (xs: string[] | undefined) => (xs ?? []).filter(Boolean);
const quote = (s: string) => `“${s.length > 70 ? `${s.slice(0, 67)}…` : s}”`;

function listChange(label: string, before: string[], after: string[]): string[] {
  const added = after.filter((x) => !before.includes(x));
  const removed = before.filter((x) => !after.includes(x));
  const out: string[] = [];
  if (added.length) out.push(`${label}: added ${added.map((x) => quote(x)).join(", ")}.`);
  if (removed.length) out.push(`${label}: removed ${removed.map((x) => quote(x)).join(", ")}.`);
  return out;
}

function textChange(label: string, before: string | undefined, after: string | undefined): string[] {
  const b = (before ?? "").trim();
  const a = (after ?? "").trim();
  if (a === b) return [];
  if (!a) return [`${label}: cleared.`];
  if (!b) return [`${label}: set to ${quote(a)}.`];
  return [`${label}: ${quote(b)} → ${quote(a)}.`];
}

/**
 * What changed between two saved states of a pack, in the person's terms.
 * Covers what a person decides; measurements are summarised by the scan's own
 * "what moved" report instead.
 */
export function diffPacks(before: Snap, after: Snap): string[] {
  const out: string[] = [];
  out.push(...textChange("Voice line", before.voiceLine, after.voiceLine));
  out.push(...listChange("Hard rules", list(before.hardRules), list(after.hardRules)));
  out.push(...listChange("Never use", list(before.index?.neverWords), list(after.index?.neverWords)));
  out.push(...listChange("Kept habits", list(before.index?.allowedExceptions), list(after.index?.allowedExceptions)));

  const g = (p: Snap) => Object.fromEntries((p.guardrails ?? []).map((x) => [x.id, x]));
  const gb = g(before);
  const ga = g(after);
  for (const id of new Set([...Object.keys(gb), ...Object.keys(ga)])) {
    out.push(...textChange(ga[id]?.name ?? gb[id]?.name ?? "A line", gb[id]?.rule, ga[id]?.rule));
  }

  const ib = before.identity ?? {};
  const ia = after.identity ?? {};
  out.push(...textChange("Your reader", ib.reader?.value, ia.reader?.value));
  out.push(...textChange("The one idea", ib.carries?.value, ia.carries?.value));
  out.push(
    ...listChange(
      "Four words",
      (ib.personalityWords?.value ?? []).map((w) => w.word),
      (ia.personalityWords?.value ?? []).map((w) => w.word),
    ),
  );
  const db = ib.dials?.value ?? {};
  const da = ia.dials?.value ?? {};
  for (const k of DIAL_KEYS as readonly DialKey[]) {
    if (db[k] !== da[k] && da[k] != null) {
      const [l, r] = DIAL_LABELS[k];
      out.push(`Dial ${l} ↔ ${r}: ${db[k] ?? "unset"} → ${da[k]}.`);
    }
  }

  const ob = (before.mechanics?.openers?.value ?? []).map((o) => o.example);
  const oa = (after.mechanics?.openers?.value ?? []).map((o) => o.example);
  const dropped = ob.filter((x) => !oa.includes(x));
  if (dropped.length && oa.length < ob.length) out.push(`Openers: dropped ${dropped.map((x) => quote(x)).join(", ")}.`);

  if (before.workMode && after.workMode && before.workMode !== after.workMode) {
    out.push(`Way of working: ${before.workMode} → ${after.workMode}.`);
  }
  const pb = before.corpusStats?.pieces;
  const pa = after.corpusStats?.pieces;
  if (pb != null && pa != null && pb !== pa) out.push(`Writing on file: ${pb} → ${pa} pieces.`);
  return out;
}

// ---- one-tap confirms (plan, Flow 1 step 2) ---------------------------------

export interface Prefill {
  value: string | string[];
  /** Where it came from, said to the person: "your brief", "your writing". */
  from: string;
  /** Why we think so: a short quote or reason from their material. */
  evidence?: string;
}

/**
 * A Core question we can already answer becomes a one-tap confirm instead of a
 * blank box. Taken from the pack itself (an earlier answer, the pre-workshop
 * questionnaire, the old voice guide) or, failing that, from the brief.
 */
export function prefill(
  questionId: string,
  current: string | string[] | undefined,
  brief: { audience?: string },
  suggestion?: { value: string | string[]; evidence?: string } | null,
): Prefill | null {
  const has = (v: string | string[] | undefined) => (Array.isArray(v) ? v.length > 0 : !!v?.trim());
  if (has(current)) return { value: current!, from: "what we already have" };
  if (suggestion && has(suggestion.value)) return { value: suggestion.value, from: "your writing", evidence: suggestion.evidence };
  if (questionId === "A2" && brief.audience?.trim()) return { value: brief.audience.trim(), from: "your brief" };
  return null;
}
