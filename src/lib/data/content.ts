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
import { generateText, runTask, streamText } from "@/lib/ai";
import { rewritePart } from "@/lib/ai/tasks";
import { splitStreamed } from "@/lib/ai/prompt";
import { resolveTemplate } from "@/lib/ai/templates";
import { findViolations, formatByKey, splitDraft } from "@/lib/content/formats";
import { recordOpener } from "./voice-pack";

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
  violations: string[];
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
          WHERE ci.project_id = $1 ORDER BY g.created_at ASC`,
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
        violations: findViolations(text, ctx.guardrails.dontWords),
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

type DraftInput = { format: string; topic?: string; pillarId?: string | null; variants?: number; ideaId?: string | null };

/** Everything a draft needs before the model is called: the one context (INV-2), the template, the task. */
async function prepareDraft(scope: ProjectScope, input: DraftInput) {
  const fmt = formatByKey(input.format);
  // The platform's rules and the person's own block for it (build step 2).
  const context = await loadBrandContext(scope, "en", fmt.platform, fmt.reply ? "reply" : "write");
  const template = await resolveTemplate(scope, fmt.templateKey);
  const topic = (input.topic ?? "").trim();
  return {
    fmt,
    template,
    topic,
    req: {
      templateKey: template.key,
      systemTemplate: template.body,
      context,
      taskInput: `Format: ${fmt.label}\nTopic: ${topic}`,
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
         VALUES ($1,$12,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10,$11) RETURNING id`,
        [scope.tenantId, p.fmt.channel, p.fmt.key, p.topic || null, first.hook, first.body, first.cta,
         input.pillarId || null, p.template.version, p.template.id, scope.userId, scope.projectId],
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
  return saveDraft(scope, input, p, result.variants, result.model);
}

/**
 * The same draft, written live (brief §07). Yields the text as it arrives;
 * the last event names the saved piece. The piece is stored exactly as
 * generateContent stores it, so streamed and one-shot drafts are the same
 * thing in the library, the history and the export.
 */
export async function* streamContent(
  scope: ProjectScope,
  input: DraftInput,
): AsyncGenerator<{ type: "delta"; text: string } | { type: "saved"; id: string }> {
  const p = await prepareDraft(scope, input);
  for await (const ev of streamText(scope, p.req)) {
    if (ev.type === "delta") yield ev;
    else yield { type: "saved", id: await saveDraft(scope, input, p, splitStreamed(ev.text), ev.model) };
  }
}

/**
 * Select and instruct (canvas): one part of a piece rewritten as asked. Reads
 * the piece for context and the one brand context (INV-2); returns the new
 * text and writes nothing, so the caller commits it like a typed edit.
 */
export async function rewritePartOf(
  scope: ProjectScope,
  itemId: string,
  ask: { part: string; text: string; instruction: string },
): Promise<string | null> {
  const item = (
    await withTenantSession(scope, (c) => c.query("SELECT * FROM content_items WHERE id=$1 AND project_id=$2", [itemId, scope.projectId]))
  ).rows[0];
  if (!item) return null;
  const fmt = formatByKey(item.format);
  const context = await loadBrandContext(scope, "en", fmt.platform, "rewrite");
  const { text } = await runTask(scope, rewritePart, {
    context,
    contentItemId: itemId,
    taskInput: [
      `Format: ${fmt.label}`,
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
  return text.trim().replace(/^["“]([\s\S]*)["”]$/, "$1");
}

/** Regenerate with a steer; keeps every previous version in history (§4.2). */
export async function regenerateWithSteer(scope: ProjectScope, itemId: string, steer: string): Promise<void> {
  const item = (
    await withTenantSession(scope, (c) => c.query("SELECT * FROM content_items WHERE id=$1 AND project_id=$2", [itemId, scope.projectId]))
  ).rows[0];
  if (!item) throw new Error("content item not found");
  const fmt = formatByKey(item.format);
  const context = await loadBrandContext(scope, "en", fmt.platform, fmt.reply ? "reply" : "write");
  const template = await resolveTemplate(scope, fmt.templateKey);
  const result = await generateText(scope, {
    templateKey: template.key,
    systemTemplate: template.body,
    context,
    taskInput: `Format: ${fmt.label}\nTopic: ${item.topic ?? ""}\nSteer: ${steer}\nPrevious:\n${item.hook}\n${item.body}`,
    variants: 2,
    contentItemId: itemId,
  });
  const d = splitDraft(result.variants[0]);
  await withTenantSession(scope, async (c) => {
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
      [scope.tenantId, itemId, next, steer, d.hook, d.body, d.cta, template.version, result.model],
    );
    await c.query(
      `UPDATE content_items SET hook=$1, body=$2, cta=$3, status='draft', prompt_version=$4 WHERE id=$5`,
      [d.hook, d.body, d.cta, template.version, itemId],
    );
  });
}

export async function applyVariant(scope: ProjectScope, itemId: string, generationId: string): Promise<void> {
  await withTenantSession(scope, async (c) => {
    const g = (
      await c.query("SELECT * FROM content_generations WHERE id=$1 AND content_item_id=$2", [generationId, itemId])
    ).rows[0];
    if (!g) throw new Error("variant not found");
    await c.query("UPDATE content_items SET hook=$1, body=$2, cta=$3 WHERE id=$4 AND project_id=$5", [g.hook, g.body, g.cta, itemId, scope.projectId]);
  });
}

export async function updateContent(
  scope: ProjectScope,
  itemId: string,
  patch: { hook: string; body: string; cta: string; pillarId: string | null; status: "draft" | "edited" | "approved" },
): Promise<void> {
  await withTenantSession(scope, (c) =>
    c.query(
      `UPDATE content_items SET hook=$1, body=$2, cta=$3, pillar_id=$4, status=$5 WHERE id=$6 AND project_id=$7`,
      [patch.hook, patch.body, patch.cta, patch.pillarId, patch.status, itemId, scope.projectId],
    ),
  );
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
): Promise<void> {
  const copyChanged = patch.hook !== undefined || patch.body !== undefined || patch.cta !== undefined;
  const movePillar = patch.pillarId !== undefined;
  await withTenantSession(scope, (c) =>
    c.query(
      `UPDATE content_items SET
          hook = COALESCE($1, hook),
          body = COALESCE($2, body),
          cta  = COALESCE($3, cta),
          pillar_id = CASE WHEN $4 THEN $5::uuid ELSE pillar_id END,
          status = CASE WHEN $6 THEN 'edited' ELSE status END
        WHERE id = $7 AND project_id = $8
          AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM pillars WHERE id = $5::uuid AND project_id IS NULL))`,
      [patch.hook ?? null, patch.body ?? null, patch.cta ?? null, movePillar, patch.pillarId ?? null, copyChanged, itemId, scope.projectId],
    ),
  );
}

export async function deleteContent(scope: ProjectScope, itemId: string): Promise<void> {
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
  },
): Promise<string> {
  const fmt = formatByKey(input.format);
  return withTenantSession(scope, async (c) => {
    const id = (
      await c.query<{ id: string }>(
        `INSERT INTO content_items
           (tenant_id, project_id, channel, format, topic, hook, body, cta, pillar_id, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [scope.tenantId, scope.projectId, fmt.channel, fmt.key, input.topic || null, input.hook, input.body,
         input.cta, input.pillarId || null, input.status, scope.userId],
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
