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
import { EMPTY_INDEX } from "@/lib/voice/types";
import { listSamples, loadPackForWorkspace } from "./voice-pack";
import type { ProjectScope, WorkspaceScope } from "./projects";
import { withTenantSession } from "@/db/session";
import { formatByKey } from "@/lib/content/formats";
import { runTask } from "@/lib/ai";
import { rewriteInVoice, voiceJudge, type JudgeResult } from "@/lib/ai/tasks";
import { loadBrandContext } from "@/lib/context/context-loader";

export interface CheckOutcome extends VoiceCheckResult {
  /** Pieces of the person's writing the verdict rests on. */
  corpusPieces: number;
  platform: string | null;
}

export async function checkText(
  scope: WorkspaceScope,
  text: string,
  platform?: string | null,
): Promise<CheckOutcome> {
  const pack = await loadPackForWorkspace(scope);
  const samples = pack ? await listSamples(scope, pack.id) : [];

  const corpusUses: Record<string, number> = {};
  for (const phrase of ANTI_AI_PHRASES) {
    corpusUses[phrase] = samples.reduce((n, s) => n + (s.body.toLowerCase().includes(phrase) ? 1 : 0), 0);
  }

  const result = checkDraft(text, pack?.index ?? EMPTY_INDEX, {
    channel: platform ?? undefined,
    corpusPieces: samples.length,
    corpusUses,
  });
  return { ...result, corpusPieces: samples.length, platform: platform ?? null };
}

/**
 * Check one piece and remember the result on it (migration 0012), so the
 * Library can filter by band without re-reading the corpus per card.
 */
export async function scoreContentItem(scope: ProjectScope, itemId: string): Promise<CheckOutcome | null> {
  const row = (
    await withTenantSession(scope, (c) =>
      c.query<{ hook: string | null; body: string | null; cta: string | null; format: string }>(
        `SELECT hook, body, cta, format FROM content_items WHERE id = $1 AND project_id = $2`,
        [itemId, scope.projectId],
      ),
    )
  ).rows[0];
  if (!row) return null;
  const text = [row.hook, row.body, row.cta].filter(Boolean).join("\n\n");
  const result = await checkText(scope, text, formatByKey(row.format).platform);
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

function judgeInput(text: string, neverWords: string[], platform?: string | null): string {
  return [
    platform ? `Platform: ${platform}` : "",
    neverWords.length ? `Never use: ${neverWords.join(", ")}` : "",
    "",
    "Draft:",
    text.trim(),
  ].filter((l, i) => l !== "" || i > 1).join("\n");
}

/**
 * Line-level findings with a fix in their voice (§15.4). The model reads the
 * same one context block as every draft (INV-2), for the same platform.
 */
export async function judgeText(scope: WorkspaceScope, text: string, platform?: string | null): Promise<JudgeResult["findings"]> {
  const pack = await loadPackForWorkspace(scope);
  const { findings } = await runTask(scope, voiceJudge, {
    context: await loadBrandContext(scope, "en", platform ?? undefined),
    taskInput: judgeInput(text, pack?.index.neverWords ?? [], platform),
  });
  // Keep only findings that quote the draft: a line the model invented can't
  // be highlighted or replaced, so it can't be acted on either.
  const draft = text.replace(/\s+/g, " ");
  return findings.filter((f) => f.line.trim() && draft.includes(f.line.replace(/\s+/g, " ").trim()));
}

/** The whole draft rewritten in their voice: the primary action when off brand. */
export async function rewriteText(scope: WorkspaceScope, text: string, platform?: string | null): Promise<string> {
  const pack = await loadPackForWorkspace(scope);
  const { text: out } = await runTask(scope, rewriteInVoice, {
    context: await loadBrandContext(scope, "en", platform ?? undefined),
    taskInput: judgeInput(text, pack?.index.neverWords ?? [], platform),
  });
  return out;
}
