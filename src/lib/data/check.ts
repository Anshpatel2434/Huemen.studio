/**
 * The one way to check a draft against a person's voice.
 *
 * Both the in-project check and the Check surface come through here, so the
 * same draft scores the same everywhere. It assembles what the pure checker
 * (lib/voice/check) needs from storage: the voice index, the platform, and how
 * often each watch-list phrase appears in the person's OWN writing — the count
 * that lets a finding cite their corpus instead of a generic rule (§15.4).
 *
 * Counting reads private pieces too. That is measuring, not quoting: a count
 * leaves the corpus, a sentence never does.
 *
 * Server-only.
 */
import "server-only";
import { checkDraft, type VoiceCheckResult } from "@/lib/voice/check";
import { ANTI_AI_PHRASES } from "@/lib/voice/platforms";
import { EMPTY_INDEX, type VoiceSample } from "@/lib/voice/types";
import { listSamples, loadPackForWorkspace } from "./voice-pack";
import type { ProjectScope, WorkspaceScope } from "./projects";
import { withTenantSession } from "@/db/session";
import { formatByKey } from "@/lib/content/formats";
import { runTask, runTaskStamped } from "@/lib/ai";
import { rewriteInVoice, voiceJudge, type LineFinding } from "@/lib/ai/tasks";
import { loadBrandContext } from "@/lib/context/context-loader";
import { addedClaims, flaggedPhrases, vetFindings } from "@/lib/voice/judge";
import { angleLine } from "@/lib/content/angles";
import type { UnsupportedClaim } from "@/lib/voice/facts";
import { isUuid } from "@/lib/content/ids";

export interface CheckOutcome extends VoiceCheckResult {
  /** Pieces of the person's writing the verdict rests on. */
  corpusPieces: number;
  platform: string | null;
}

/**
 * Everything a draft may state as fact (FACTS_RULE): the one brand context
 * (proofs, stories, offers, the brief), the person's PUBLIC writing, and the
 * piece's topic. Private writing is not grounding: it teaches rhythm during the
 * scan, and a fact that appears only in sent email or chat does not back a
 * draft (the same rule voice-pack applies to "Facts they can stand behind", H7).
 * Shared by the check, the line-level reading and its fixes, and the rewrites
 * and steers that are saved (addedClaims).
 */
export async function groundingFor(scope: WorkspaceScope, topic?: string | null, samples?: VoiceSample[]): Promise<string> {
  const context = await loadBrandContext(scope);
  let pool = samples;
  if (!pool) {
    const pack = await loadPackForWorkspace(scope);
    pool = pack ? await listSamples(scope, pack.id) : [];
  }
  const publicBodies = pool.filter((s) => s.visibility === "public").map((s) => s.body);
  return [context.serialized, ...publicBodies, topic ?? ""].join("\n");
}

export async function checkText(
  scope: WorkspaceScope,
  text: string,
  platform?: string | null,
  /**
   * Check that a DRAFT doesn't copy their writing word for word. Off for their
   * own writing (the Check page, a piece from their corpus), which would
   * otherwise "copy" itself.
   */
  opts: { copyCheck?: boolean; topic?: string | null } = {},
): Promise<CheckOutcome> {
  const pack = await loadPackForWorkspace(scope);
  const samples = pack ? await listSamples(scope, pack.id) : [];

  const corpusUses: Record<string, number> = {};
  for (const phrase of ANTI_AI_PHRASES) {
    corpusUses[phrase] = samples.reduce((n, s) => n + (s.body.toLowerCase().includes(phrase) ? 1 : 0), 0);
  }

  const grounding = await groundingFor(scope, opts.topic, samples);

  const result = checkDraft(text, pack?.index ?? EMPTY_INDEX, {
    channel: platform ?? undefined,
    corpusPieces: samples.length,
    corpusUses,
    // Only public writing can be quoted back to them in a finding.
    corpusTexts: opts.copyCheck ? samples.filter((s) => s.visibility === "public").map((s) => s.body) : [],
    recentOpeners: pack?.index.lastOpeners,
    // Measured, so "you don't use hashtags" is a count, not a house rule.
    hashtagsPerPiece: pack?.mechanics.hashtags?.value?.count ?? null,
    grounding,
  });
  return { ...result, corpusPieces: samples.length, platform: platform ?? null };
}

/**
 * Check one piece and remember the result on it (migration 0012), so the
 * Library can filter by band without re-reading the corpus per card.
 */
export async function scoreContentItem(scope: ProjectScope, itemId: string): Promise<CheckOutcome | null> {
  if (!isUuid(itemId)) return null;
  const row = (
    await withTenantSession(scope, (c) =>
      c.query<{ hook: string | null; body: string | null; cta: string | null; format: string; topic: string | null }>(
        `SELECT hook, body, cta, format, topic FROM content_items WHERE id = $1 AND project_id = $2`,
        [itemId, scope.projectId],
      ),
    )
  ).rows[0];
  if (!row) return null;
  const text = [row.hook, row.body, row.cta].filter(Boolean).join("\n\n");
  const result = await checkText(scope, text, formatByKey(row.format).platform, { copyCheck: true, topic: row.topic });
  await withTenantSession(scope, (c) =>
    c.query(
      `UPDATE content_items SET voice_score = $1, voice_band = $2, voice_checked_at = now() WHERE id = $3`,
      [result.score, result.band, itemId],
    ),
  );
  return result;
}

/** Re-score every piece in a project after something in it changed. */
export async function scoreProject(scope: ProjectScope): Promise<void> {
  const ids = (
    await withTenantSession(scope, (c) =>
      c.query<{ id: string }>(`SELECT id FROM content_items WHERE project_id = $1`, [scope.projectId]),
    )
  ).rows.map((r) => r.id);
  for (const id of ids) await scoreContentItem(scope, id);
}

// ---- the judgement half (a model call) ---------------------------------------

/**
 * The task input of a check or a rewrite: the platform, what the code check
 * already flagged IN THIS DRAFT (so the model's fix can't keep it), and the
 * draft. The flagged list describes the draft; the rules behind it (their
 * never-list, the guardrails) stay in the one context block (INV-2).
 */
function judgeInput(
  text: string,
  flagged: string[],
  platform?: string | null,
  mustFix: string[] = [],
  /** A rewrite keeps the piece's brief: its topic, pillar and angle are binding (M4). */
  brief: Brief = {},
): string {
  return [
    platform ? `Platform: ${platform}` : "",
    brief.topic?.trim() ? `Topic: ${brief.topic.replace(/\s+/g, " ").trim()}` : "",
    brief.pillar?.trim() ? `Pillar: ${brief.pillar.trim()}` : "",
    angleLine(brief.angle),
    flagged.length ? `Already flagged: ${flagged.map((p) => `"${p}"`).join(", ")}` : "",
    // For a rewrite: what the code check says has to go (hashtags or marks
    // that are not theirs, the length), in the words the person is shown.
    mustFix.length ? `The check on this draft says, to the writer: ${mustFix.join(" ")}` : "",
    "",
    "Draft:",
    text.trim(),
  ].filter(Boolean).join("\n").replace("\nDraft:\n", "\n\nDraft:\n");
}

/** The brief a piece was set up with, as the rewrite is told it (the same lines a draft gets). */
export interface Brief {
  topic?: string | null;
  pillar?: string | null;
  angle?: string | null;
}

/**
 * Line-level findings with a fix in their voice (§15.4). The model reads the
 * same one context block as every draft (INV-2), for the same platform. What
 * comes back is vetted in code (lib/voice/judge) before anyone sees it.
 */
export async function judgeText(
  scope: WorkspaceScope,
  text: string,
  platform?: string | null,
  /** The piece being checked, so the call is logged against it. */
  contentItemId?: string | null,
  /** The piece's topic: a fact the topic states is grounded, so a fix may keep it. */
  topic?: string | null,
): Promise<LineFinding[]> {
  const pack = await loadPackForWorkspace(scope);
  const index = pack?.index ?? EMPTY_INDEX;
  const { findings } = await runTask(scope, voiceJudge, {
    context: await loadBrandContext(scope, "en", platform ?? undefined, "check"),
    taskInput: judgeInput(text, flaggedPhrases(text, index), platform),
    contentItemId: contentItemId ?? null,
  });
  // A fix may not contain anything the check would flag, whether or not it
  // was in this draft: a fix that swaps one stock phrase for another is no fix.
  const exceptions = index.allowedExceptions.map((e) => e.toLowerCase());
  const banned = [...index.neverWords, ...ANTI_AI_PHRASES.filter((p) => !exceptions.includes(p))];
  // And a fix may not state a fact the brand context does not have (FACTS_RULE).
  return vetFindings(text, findings, banned, await groundingFor(scope, topic));
}

/** The whole draft rewritten in their voice: the primary action when off brand. */
export async function rewriteText(scope: WorkspaceScope, text: string, platform?: string | null): Promise<string> {
  return (await rewriteTextStamped(scope, text, platform)).text;
}

/**
 * The same rewrite, saying which template wrote it, for a rewrite that lands
 * on a saved piece (which is then stamped and its log row linked to it).
 */
export async function rewriteTextStamped(
  scope: WorkspaceScope,
  text: string,
  platform?: string | null,
  contentItemId?: string | null,
  brief: Brief = {},
): Promise<{ text: string; template: { id: string | null; version: number }; model: string; unsupported: UnsupportedClaim[] }> {
  const pack = await loadPackForWorkspace(scope);
  // The rewrite is told what the code check found, so it fixes the things the
  // person will be shown: a rewrite that keeps the hashtags scores no better.
  const found = await checkText(scope, text, platform);
  const mustFix = found.issues.filter((i) => i.mustFix && i.code !== "watch_phrase" && i.code !== "never_word").map((i) => i.message);
  const { data, template, model } = await runTaskStamped(scope, rewriteInVoice, {
    context: await loadBrandContext(scope, "en", platform ?? undefined, "rewrite"),
    taskInput: judgeInput(text, flaggedPhrases(text, pack?.index ?? EMPTY_INDEX), platform, mustFix, brief),
    contentItemId: contentItemId ?? null,
  });
  // A rewrite may not add a fact the brand context and the piece do not have.
  // The caller decides what to show; nothing is saved from here (FACTS_RULE, C2).
  const unsupported = addedClaims(text, data.text, await groundingFor(scope, brief.topic));
  return { text: data.text, template, model, unsupported };
}
