/**
 * Content Studio data + generation (brief §4.2). Every generation:
 *   loadBrandContext (INV-2) → resolveTemplate (template store) → generateText
 *   (facade: logs + retry) → content_item + content_generations history.
 * The template version is stamped on the item (prompt_version) for tracing.
 *
 * Server-only.
 */
import "server-only";
import type { PoolClient } from "pg";
import { withTenantSession } from "@/db/session";
import type { ProjectScope } from "./projects";
import { loadBrandContext } from "@/lib/context/context-loader";
import { generateText, linkGeneration, runTask, streamText } from "@/lib/ai";
import { rewritePart } from "@/lib/ai/tasks";
import { splitStreamed, STREAM_SEPARATOR } from "@/lib/ai/prompt";
import { logger } from "@/lib/observability/log";
import { resolveTemplate } from "@/lib/ai/templates";
import { findPlaceholders, findViolations, formatByKey, splitDraft } from "@/lib/content/formats";
import { angleLine } from "@/lib/content/angles";
import { isUuid, uuidOrNull } from "@/lib/content/ids";
import { recordOpener } from "./voice-pack";
import { groundingFor } from "./check";
import { addedClaims, UnsupportedRewriteError } from "@/lib/voice/judge";

/** The longest topic kept as task input. The project NAME is cut shorter, at a word (lib/data/create). */
export const TOPIC_MAX = 2000;

/** A topic as one line of task input: whitespace folded, capped. */
export const topicLine = (topic: string | null | undefined): string =>
  (topic ?? "").replace(/\s+/g, " ").trim().slice(0, TOPIC_MAX);

export interface ContentVariant {
  id: string;
  variantIndex: number;
  steer: string | null;
  hook: string;
  body: string;
  cta: string;
  model: string | null;
  createdAt: string;
}

export interface ContentItemView {
  id: string;
  format: string;
  channel: string;
  topic: string | null;
  hook: string;
  body: string;
  cta: string;
  status: string;
  pillarId: string | null;
  pillarName: string | null;
  promptVersion: number | null;
  createdAt: string;
  /** When the copy last changed (a regenerate, a rewrite, an edit); score-only updates don't move it (0012). */
  updatedAt: string;
  violations: string[];
  /** "[placeholder]"s still in the hook, body or call to action (lib/content/formats). */
  placeholders: string[];
  history: ContentVariant[];
}

export async function listContent(scope: ProjectScope): Promise<ContentItemView[]> {
  const ctx = await loadBrandContext(scope);
  return withTenantSession(scope, async (c) => {
    const items = (
      await c.query(
        `SELECT ci.*, p.name AS pillar_name FROM content_items ci
           LEFT JOIN pillars p ON p.id = ci.pillar_id
          WHERE ci.project_id = $1
          ORDER BY ci.created_at DESC LIMIT 80`,
        [scope.projectId],
      )
    ).rows;
    const gens = (
      await c.query(
        `SELECT g.* FROM content_generations g JOIN content_items ci ON ci.id = g.content_item_id
          WHERE ci.project_id = $1 ORDER BY g.created_at ASC, g.variant_index ASC`,
        [scope.projectId],
      )
    ).rows;
    return items.map((r) => {
      const text = [r.hook, r.body, r.cta].filter(Boolean).join("\n");
      return {
        id: r.id,
        format: r.format,
        channel: r.channel,
        topic: r.topic,
        hook: r.hook ?? "",
        body: r.body ?? "",
        cta: r.cta ?? "",
        status: r.status,
        pillarId: r.pillar_id,
        pillarName: r.pillar_name,
        promptVersion: r.prompt_version,
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at ?? r.created_at).toISOString(),
        violations: findViolations(text, ctx.guardrails.dontWords),
        placeholders: findPlaceholders(text),
        history: gens
          .filter((g) => g.content_item_id === r.id)
          .map((g) => ({
            id: g.id,
            variantIndex: g.variant_index,
            steer: g.steer,
            hook: g.hook ?? "",
            body: g.body ?? "",
            cta: g.cta ?? "",
            model: g.model,
            createdAt: new Date(g.created_at).toISOString(),
          })),
      };
    });
  });
}

type DraftInput = {
  format: string;
  topic?: string;
  pillarId?: string | null;
  variants?: number;
  ideaId?: string | null;
  /** The angle chosen at Ideate, when this draft is the piece the project is about. */
  angle?: string | null;
};

/** A workspace pillar's name, or null when the id is not one of this workspace's (RLS decides). */
async function pillarName(scope: ProjectScope, pillarId: string | null | undefined): Promise<string | null> {
  if (!isUuid(pillarId)) return null;
  return (
    await withTenantSession(scope, (c) => c.query<{ name: string }>("SELECT name FROM pillars WHERE id = $1 AND project_id IS NULL", [pillarId]))
  ).rows[0]?.name ?? null;
}

/**
 * The task input of a draft: what THIS piece is. The pillar is named (what it
 * means is in the brand context, INV-2) and the angle carries what it asks of
 * the draft, because the contract (lib/ai/prompt) calls both binding.
 */
function draftTask(fmtLabel: string, topic: string, pillar: string | null, angle: string | null | undefined): string {
  return [`Format: ${fmtLabel}`, `Topic: ${topic}`, pillar ? `Pillar: ${pillar}` : "", angleLine(angle)].filter(Boolean).join("\n");
}

/** Everything a draft needs before the model is called: the one context (INV-2), the template, the task. */
async function prepareDraft(scope: ProjectScope, input: DraftInput) {
  const fmt = formatByKey(input.format);
  // The platform's rules and the person's own block for it (build step 2).
  const context = await loadBrandContext(scope, "en", fmt.platform, fmt.reply ? "reply" : "write");
  const template = await resolveTemplate(scope, fmt.templateKey);
  const topic = topicLine(input.topic);
  // An id that is not this workspace's pillar is dropped here, quietly: the
  // draft is written without a pillar rather than failing on a database error.
  const pillar = await pillarName(scope, input.pillarId);
  // The angle is read here, in the draft path itself, so every caller gets it:
  // the studio, the agent, the pipeline and the job queue (H6). A caller's angle
  // is only the fallback for a project that has none.
  const angle = (await projectAngle(scope)) ?? input.angle ?? null;
  return {
    fmt,
    template,
    topic,
    pillarId: pillar ? (input.pillarId as string) : null,
    req: {
      templateKey: template.key,
      systemTemplate: template.body,
      context,
      taskInput: draftTask(fmt.label, topic, pillar, angle),
      variants: Math.min(3, Math.max(2, input.variants ?? 2)),
      route: (fmt.key === "hook_set" ? "cheap" : "strong") as "cheap" | "strong",
    },
  };
}

/** Store a finished draft: the piece (first version) and every version in its history. */
async function saveDraft(
  scope: ProjectScope,
  input: DraftInput,
  p: Awaited<ReturnType<typeof prepareDraft>>,
  variants: string[],
  model: string,
): Promise<string> {
  const drafts = variants.map(splitDraft).filter((d) => d.hook || d.body);
  if (!drafts.length) throw new Error("The draft came back empty.");
  const first = drafts[0];
  return withTenantSession(scope, async (c) => {
    const id = (
      await c.query<{ id: string }>(
        `INSERT INTO content_items
           (tenant_id, project_id, channel, format, topic, hook, body, cta, pillar_id, status,
            prompt_version, prompt_template_id, created_by)
         VALUES ($1,$12,$2,$3,$4,$5,$6,$7,(SELECT id FROM pillars WHERE id = $8::uuid AND project_id IS NULL),'draft',$9,$10,$11) RETURNING id`,
        [scope.tenantId, p.fmt.channel, p.fmt.key, p.topic || null, first.hook, first.body, first.cta,
         p.pillarId, p.template.version, p.template.id, scope.userId, scope.projectId],
      )
    ).rows[0].id;
    for (const [i, d] of drafts.entries()) {
      await c.query(
        `INSERT INTO content_generations
           (tenant_id, content_item_id, variant_index, hook, body, cta, prompt_version, model)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [scope.tenantId, id, i, d.hook, d.body, d.cta, p.template.version, model],
      );
    }
    await linkIdea(c, id, scope.projectId);
    return id;
  });
}

/** Generate 2–3 variants for a format; returns the new content_item id. */
export async function generateContent(scope: ProjectScope, input: DraftInput): Promise<string> {
  const p = await prepareDraft(scope, input);
  const result = await generateText(scope, p.req);
  const id = await saveDraft(scope, input, p, result.variants, result.model);
  // The call was logged before the piece existed; now it has one to point at.
  await linkGeneration(scope, result.logId, id);
  return id;
}

/**
 * The same draft, written live (brief §07). Yields the text as it arrives;
 * the last event names the saved piece. The piece is stored exactly as
 * generateContent stores it, so streamed and one-shot drafts are the same
 * thing in the library, the history and the export.
 *
 * Versions (audit H4): a streamed draft splits into versions at a line holding
 * only STREAM_SEPARATOR. When the count is not the number asked for, the
 * separator was lost or doubled, so the streamed words cannot be split safely.
 * The draft is written once more without streaming; if that one has the right
 * count, its text is sent as a "replace" event so the canvas shows only what
 * is saved, and it is saved. If it is still the wrong count, nothing is saved.
 *
 * Link (audit L3): the piece exists once saveDraft returns, so it is reported
 * as saved even if linking its generation logs fails (that is logged instead).
 */
export async function* streamContent(
  scope: ProjectScope,
  input: DraftInput,
): AsyncGenerator<{ type: "delta"; text: string } | { type: "replace"; text: string } | { type: "saved"; id: string }> {
  const p = await prepareDraft(scope, input);
  const wanted = p.req.variants;
  for await (const ev of streamText(scope, p.req)) {
    if (ev.type === "delta") {
      yield ev;
      continue;
    }
    let versions = splitStreamed(ev.text);
    let model = ev.model;
    const logIds = [ev.logId];
    if (versions.length !== wanted) {
      const again = await generateText(scope, p.req);
      if (again.variants.length !== wanted) {
        throw new Error("The draft came back in the wrong number of versions. Try again.");
      }
      versions = again.variants;
      model = again.model;
      logIds.push(again.logId);
      yield { type: "replace", text: versions.join(`\n${STREAM_SEPARATOR}\n`) };
    }
    const id = await saveDraft(scope, input, p, versions, model);
    for (const logId of logIds) {
      await linkGeneration(scope, logId, id).catch((e: unknown) =>
        logger.warn("generation_link_failed", { contentItemId: id, error: e instanceof Error ? e.message : String(e) }),
      );
    }
    yield { type: "saved", id };
  }
}

/** One piece of this project, or null: a malformed id, or one from elsewhere, is simply not found. */
async function findItem(scope: ProjectScope, itemId: string) {
  if (!isUuid(itemId)) return null;
  return (
    await withTenantSession(scope, (c) => c.query("SELECT * FROM content_items WHERE id=$1 AND project_id=$2", [itemId, scope.projectId]))
  ).rows[0] ?? null;
}

/** The angle this project's piece was set up with at Ideate. */
async function projectAngle(scope: ProjectScope): Promise<string | null> {
  return (
    await withTenantSession(scope, (c) => c.query<{ angle: string | null }>("SELECT angle FROM projects WHERE id = $1", [scope.projectId]))
  ).rows[0]?.angle ?? null;
}

/**
 * Select and instruct (canvas): one part of a piece rewritten as asked. Reads
 * the piece for context and the one brand context (INV-2); returns the new
 * text and writes nothing, so the caller commits it like a typed edit.
 *
 * A rewrite that adds a number, quote, event or named method which neither the
 * brand context nor the piece states is not returned: UnsupportedRewriteError
 * carries it, and nothing is saved (C2). The rewrite keeps the piece's brief:
 * its topic, pillar and angle are passed in (M4).
 */
export async function rewritePartOf(
  scope: ProjectScope,
  itemId: string,
  ask: { part: string; text: string; instruction: string },
): Promise<string | null> {
  const item = await findItem(scope, itemId);
  if (!item) return null;
  const fmt = formatByKey(item.format);
  const context = await loadBrandContext(scope, "en", fmt.platform, "rewrite");
  const [pillar, angle] = await Promise.all([pillarName(scope, item.pillar_id), projectAngle(scope)]);
  const topic = topicLine(item.topic);
  const { text } = await runTask(scope, rewritePart, {
    context,
    contentItemId: itemId,
    taskInput: [
      `Format: ${fmt.label}`,
      topic ? `Topic: ${topic}` : "",
      pillar ? `Pillar: ${pillar}` : "",
      angleLine(angle),
      `Part kind: ${ask.part}`,
      `Instruction: ${ask.instruction.replace(/\n+/g, " ")}`,
      "",
      "Part:",
      ask.text,
      "",
      "Whole piece:",
      [item.hook, item.body, item.cta ? `CTA: ${item.cta}` : ""].filter(Boolean).join("\n"),
    ].join("\n"),
  });
  const out = text.trim().replace(/^["“]([\s\S]*)["”]$/, "$1");
  const added = addedClaims(ask.text, out, await groundingFor(scope, topic));
  if (added.length) throw new UnsupportedRewriteError(added, out);
  return out;
}

/** Regenerate with a steer; keeps every previous version in history (§4.2). */
export async function regenerateWithSteer(scope: ProjectScope, itemId: string, steer: string): Promise<void> {
  const item = await findItem(scope, itemId);
  if (!item) throw new ContentNotFoundError();
  const fmt = formatByKey(item.format);
  const context = await loadBrandContext(scope, "en", fmt.platform, fmt.reply ? "reply" : "write");
  const template = await resolveTemplate(scope, fmt.templateKey);
  const [pillar, angle] = await Promise.all([pillarName(scope, item.pillar_id), projectAngle(scope)]);
  const ask = steer.replace(/\s+/g, " ").trim().slice(0, 300);
  const result = await generateText(scope, {
    templateKey: template.key,
    systemTemplate: template.body,
    context,
    // The same brief as the first draft (topic, pillar, angle: still binding),
    // then the steer and the whole previous version, call to action included.
    taskInput: [
      draftTask(fmt.label, topicLine(item.topic), pillar, angle),
      `Steer: ${ask}`,
      "Apply the steer to the previous version. Keep what the steer does not ask to change, and keep its facts: a steer is never a reason to add a number, a client or an event.",
      "",
      "Previous version:",
      [item.hook, item.body, item.cta ? `CTA: ${item.cta}` : ""].filter(Boolean).join("\n"),
    ].join("\n"),
    // One version: the steer replaces the piece, so a second would be paid for and thrown away.
    variants: 1,
    contentItemId: itemId,
  });
  const d = splitDraft(result.variants[0]);
  if (!d.hook && !d.body) throw new Error("The rewrite came back empty.");
  // A steer may not add a fact the brand context and the piece do not have (C2).
  // Checked before anything is saved: the piece keeps its text, and the claims are
  // carried in the error for the caller to show. A claim the piece already had is not new.
  const before = [item.hook, item.body, item.cta].filter(Boolean).join("\n\n");
  const after = [d.hook, d.body, d.cta].filter(Boolean).join("\n\n");
  const added = addedClaims(before, after, await groundingFor(scope, item.topic));
  if (added.length) throw new UnsupportedRewriteError(added, after);
  await withTenantSession(scope, async (c) => {
    // Whatever is on the piece now — including an edit typed since the last
    // generation — becomes a version before the steer replaces it.
    await snapshotCurrent(scope, c, itemId);
    const next = (
      await c.query<{ n: number }>(
        "SELECT coalesce(max(variant_index),-1)+1 AS n FROM content_generations WHERE content_item_id=$1",
        [itemId],
      )
    ).rows[0].n;
    await c.query(
      `INSERT INTO content_generations
         (tenant_id, content_item_id, variant_index, steer, hook, body, cta, prompt_version, model)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [scope.tenantId, itemId, next, ask, d.hook, d.body, d.cta, template.version, result.model],
    );
    await c.query(
      `UPDATE content_items SET hook=$1, body=$2, cta=$3, status='draft', prompt_version=$4, prompt_template_id=$5 WHERE id=$6`,
      [d.hook, d.body, d.cta, template.version, template.id, itemId],
    );
  });
}

export async function applyVariant(scope: ProjectScope, itemId: string, generationId: string): Promise<void> {
  if (!isUuid(itemId) || !isUuid(generationId)) throw new ContentNotFoundError();
  await withTenantSession(scope, async (c) => {
    const g = (
      await c.query(
        `SELECT g.* FROM content_generations g JOIN content_items ci ON ci.id = g.content_item_id
          WHERE g.id=$1 AND g.content_item_id=$2 AND ci.project_id=$3`,
        [generationId, itemId, scope.projectId],
      )
    ).rows[0];
    if (!g) throw new ContentNotFoundError();
    // What is on the piece now (an edit typed since) is kept as a version first.
    await snapshotCurrent(scope, c, itemId);
    await c.query("UPDATE content_items SET hook=$1, body=$2, cta=$3 WHERE id=$4 AND project_id=$5", [g.hook, g.body, g.cta, itemId, scope.projectId]);
  });
}

/** The piece (or a version of it) is not in this project: deleted, a bad id, or someone else's. */
export class ContentNotFoundError extends Error {
  constructor() {
    super("That piece isn't here any more.");
  }
}

/**
 * How a version in the history came to be, for its label (2026-11-17: a model
 * rewrite was listed as "Edited by you"). Rows written by a model keep the
 * model's name; the steer column says which kind of writing it was:
 *   null                 the first draft (one row per version)
 *   "Rewrite: ..."       a rewrite: in their voice, of one part, a line fix
 *   anything else        a steer or an ask, shown as "Rewrite: <the ask>"
 *   EDIT_STEER, no model words the person typed
 */
export const REWRITE_PREFIX = "Rewrite: ";

/**
 * Record what is on the piece now as a version a model wrote, labelled with
 * what was asked. Called right after a rewrite lands (in their voice, one
 * part, a line fix), so the history says who wrote it and the version can be
 * marked current. Skipped when that exact text is already the newest row.
 */
export async function recordRewrite(scope: ProjectScope, itemId: string, what: string, model: string | null): Promise<void> {
  if (!isUuid(itemId)) return;
  await withTenantSession(scope, async (c) => {
    const item = (
      await c.query<{ hook: string | null; body: string | null; cta: string | null; prompt_version: number | null }>(
        "SELECT hook, body, cta, prompt_version FROM content_items WHERE id=$1 AND project_id=$2",
        [itemId, scope.projectId],
      )
    ).rows[0];
    if (!item || !(item.hook || item.body)) return;
    const last = (
      await c.query<{ hook: string | null; body: string | null; cta: string | null; variant_index: number }>(
        "SELECT hook, body, cta, variant_index FROM content_generations WHERE content_item_id=$1 ORDER BY variant_index DESC LIMIT 1",
        [itemId],
      )
    ).rows[0];
    if (last && (last.hook ?? "") === (item.hook ?? "") && (last.body ?? "") === (item.body ?? "") && (last.cta ?? "") === (item.cta ?? "")) return;
    await c.query(
      `INSERT INTO content_generations
         (tenant_id, content_item_id, variant_index, steer, hook, body, cta, prompt_version, model)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [scope.tenantId, itemId, (last?.variant_index ?? -1) + 1, `${REWRITE_PREFIX}${what.replace(/\s+/g, " ").trim().slice(0, 120)}`,
       item.hook, item.body, item.cta, item.prompt_version, model || "model"],
    );
  });
}

/** Keep what is on the piece now as a version before something replaces it (see snapshotCurrent). */
export async function keepCurrentVersion(scope: ProjectScope, itemId: string): Promise<void> {
  if (!isUuid(itemId)) return;
  await withTenantSession(scope, (c) => snapshotCurrent(scope, c, itemId));
}

/**
 * Keep what is on the piece right now as a version, so nothing a person typed
 * can be lost by the next generation (brief §07). A row with no model is a
 * human edit; history labels it that way and it can be restored like any
 * variant. Skipped when the text already matches a version on file, so
 * re-saving the same words doesn't pile up entries.
 */
async function snapshotCurrent(scope: ProjectScope, c: PoolClient, itemId: string): Promise<void> {
  const item = (
    await c.query<{ hook: string | null; body: string | null; cta: string | null; prompt_version: number | null }>(
      "SELECT hook, body, cta, prompt_version FROM content_items WHERE id=$1 AND project_id=$2",
      [itemId, scope.projectId],
    )
  ).rows[0];
  if (!item || !(item.hook || item.body)) return;
  // Already in history (any version, not only the newest: a fresh draft shows
  // version 1 while version 2 is the latest row): nothing was typed, so no
  // "Edited by you" row.
  const known = await c.query(
    `SELECT 1 FROM content_generations
      WHERE content_item_id=$1 AND hook IS NOT DISTINCT FROM $2 AND body IS NOT DISTINCT FROM $3 AND cta IS NOT DISTINCT FROM $4
      LIMIT 1`,
    [itemId, item.hook, item.body, item.cta],
  );
  if (known.rowCount) return;
  const next = (
    await c.query<{ n: number }>(
      "SELECT coalesce(max(variant_index),-1)+1 AS n FROM content_generations WHERE content_item_id=$1",
      [itemId],
    )
  ).rows[0].n;
  await c.query(
    `INSERT INTO content_generations
       (tenant_id, content_item_id, variant_index, steer, hook, body, cta, prompt_version, model)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL)`,
    [scope.tenantId, itemId, next, EDIT_STEER, item.hook, item.body, item.cta, item.prompt_version],
  );
}

/** Marks a history row as something a person typed rather than a generation. */
export const EDIT_STEER = "Edited by you";

/** The piece changed (another tab, a teammate) since the editor loaded it. */
export class ContentConflictError extends Error {
  constructor() {
    super("This post changed somewhere else since you opened it (another tab, or someone else). Reload to see the latest, then make your change again.");
  }
}

/**
 * Save the whole piece from the edit panel. `base` is the copy the panel
 * started from: the save only applies if the piece still has it, so a stale
 * tab can't silently write old text over a newer edit (2026-11-17 test).
 */
export async function updateContent(
  scope: ProjectScope,
  itemId: string,
  patch: { hook: string; body: string; cta: string; pillarId: string | null; status: "draft" | "edited" | "approved" },
  base?: { hook: string; body: string; cta: string } | null,
): Promise<void> {
  // An id that isn't one is a piece that isn't there: nothing to save.
  if (!isUuid(itemId)) return;
  patch = { ...patch, pillarId: uuidOrNull(patch.pillarId) };
  await withTenantSession(scope, async (c) => {
    const r = await c.query(
      `UPDATE content_items SET hook=$1, body=$2, cta=$3, pillar_id=(SELECT id FROM pillars WHERE id = $4::uuid AND project_id IS NULL), status=$5
        WHERE id=$6 AND project_id=$7
          AND ($8::boolean IS NOT TRUE OR (hook IS NOT DISTINCT FROM $9 AND body IS NOT DISTINCT FROM $10 AND cta IS NOT DISTINCT FROM $11))`,
      [patch.hook, patch.body, patch.cta, patch.pillarId, patch.status, itemId, scope.projectId,
       !!base, base?.hook ?? null, base?.body ?? null, base?.cta ?? null],
    );
    if (base && !r.rowCount) {
      const exists = await c.query("SELECT 1 FROM content_items WHERE id=$1 AND project_id=$2", [itemId, scope.projectId]);
      if (exists.rowCount) throw new ContentConflictError();
    }
    await snapshotCurrent(scope, c, itemId);
  });
  // An approved piece's opening joins the recent openers, so the check can say
  // "you opened a recent piece the same way" (voice.json last_openers).
  if (patch.status === "approved" && patch.hook.trim()) await recordOpener(scope, patch.hook);
}

/**
 * Partial edit from the canvas (inline text, drag to another pillar). Changing
 * the copy marks the piece "edited", so an approved piece needs approving
 * again; moving it between pillars keeps its status. The pillar must be one of
 * the WORKSPACE's (migration 0007) — RLS already confines that to this tenant,
 * so a pillar from another workspace cannot be named here. Formerly this had to
 * belong to
 * the same project.
 */
export async function patchContent(
  scope: ProjectScope,
  itemId: string,
  patch: { hook?: string; body?: string; cta?: string; pillarId?: string | null },
  /** What the canvas showed for the fields it is changing: the edit only applies if they still read that. */
  base?: { hook?: string; body?: string; cta?: string } | null,
): Promise<void> {
  if (!isUuid(itemId)) return;
  const copyChanged = patch.hook !== undefined || patch.body !== undefined || patch.cta !== undefined;
  // "No pillar" (null) is a move; a pillar id that isn't an id is refused quietly.
  const movePillar = patch.pillarId !== undefined && (patch.pillarId === null || isUuid(patch.pillarId));
  if (!copyChanged && !movePillar) return;
  await withTenantSession(scope, async (c) => {
    if (base) {
      // Same rule as the edit panel (updateContent): a stale canvas (another
      // tab, or an undo from before a rewrite) must not write old words over
      // newer ones (2026-11-17 round-two test).
      const cur = (await c.query<{ hook: string; body: string; cta: string }>(
        "SELECT hook, body, cta FROM content_items WHERE id = $1 AND project_id = $2 FOR UPDATE", [itemId, scope.projectId],
      )).rows[0];
      if (cur && (["hook", "body", "cta"] as const).some((k) => base[k] !== undefined && (cur[k] ?? "") !== base[k])) throw new ContentConflictError();
    }
    await c.query(
      `UPDATE content_items SET
          hook = COALESCE($1, hook),
          body = COALESCE($2, body),
          cta  = COALESCE($3, cta),
          pillar_id = CASE WHEN $4 THEN $5::uuid ELSE pillar_id END,
          status = CASE WHEN $6 THEN 'edited' ELSE status END
        WHERE id = $7 AND project_id = $8
          AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM pillars WHERE id = $5::uuid AND project_id IS NULL))`,
      [patch.hook ?? null, patch.body ?? null, patch.cta ?? null, movePillar, movePillar ? patch.pillarId ?? null : null, copyChanged, itemId, scope.projectId],
    );
  });
}

export async function deleteContent(scope: ProjectScope, itemId: string): Promise<void> {
  if (!isUuid(itemId)) return;
  await withTenantSession(scope, (c) => c.query("DELETE FROM content_items WHERE id=$1 AND project_id=$2", [itemId, scope.projectId]));
}

/**
 * A piece that did not come from a ghostwritten draft (F2 modes): the person's
 * own writing ("check mine"), or an outline they fill in ("co-write"). Stored
 * like any other piece, with its origin in the generation history, so the
 * library, check and export treat it the same way.
 */
export async function createContentItem(
  scope: ProjectScope,
  input: {
    format: string;
    topic: string;
    hook: string;
    body: string;
    cta: string;
    pillarId?: string | null;
    status: "draft" | "edited";
    origin: "own-writing" | "co-write-outline";
    /** Set when a model wrote it: the template version that did (brief §05). */
    stamp?: { templateId: string | null; version: number } | null;
  },
): Promise<string> {
  const fmt = formatByKey(input.format);
  return withTenantSession(scope, async (c) => {
    const id = (
      await c.query<{ id: string }>(
        `INSERT INTO content_items
           (tenant_id, project_id, channel, format, topic, hook, body, cta, pillar_id, status, created_by,
            prompt_version, prompt_template_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,(SELECT id FROM pillars WHERE id = $9::uuid AND project_id IS NULL),$10,$11,$12,$13) RETURNING id`,
        [scope.tenantId, scope.projectId, fmt.channel, fmt.key, topicLine(input.topic) || null, input.hook, input.body,
         input.cta, uuidOrNull(input.pillarId), input.status, scope.userId,
         input.stamp?.version ?? null, input.stamp?.templateId ?? null],
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO content_generations (tenant_id, content_item_id, variant_index, hook, body, cta, model)
       VALUES ($1,$2,0,$3,$4,$5,$6)`,
      [scope.tenantId, id, input.hook, input.body, input.cta, input.origin],
    );
    await linkIdea(c, id, scope.projectId);
    return id;
  });
}

/**
 * The piece that came out of an idea (brief §4.5: `converted_to_content_item_id`).
 * A piece is started from an idea at Ideate, before any copy exists, so the
 * link is written here, when the first copy lands, and never overwritten.
 */
async function linkIdea(c: PoolClient, contentItemId: string, projectId: string): Promise<void> {
  await c.query(
    `UPDATE ideas SET converted_to_content_item_id = $1, status = 'converted'
      WHERE project_id IS NULL AND converted_to_content_item_id IS NULL
        AND id = (SELECT idea_id FROM projects WHERE id = $2)`,
    [contentItemId, projectId],
  );
}

/** Record which template wrote what is on a piece now (a whole-piece rewrite). */
export async function stampContentItem(scope: ProjectScope, itemId: string, stamp: { templateId: string | null; version: number }): Promise<void> {
  if (!isUuid(itemId)) return;
  await withTenantSession(scope, (c) =>
    c.query("UPDATE content_items SET prompt_version = $1, prompt_template_id = $2 WHERE id = $3 AND project_id = $4", [stamp.version, stamp.templateId, itemId, scope.projectId]),
  );
}
