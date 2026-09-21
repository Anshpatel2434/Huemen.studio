/**
 * Content Studio data + generation (brief §4.2). Every generation:
 *   loadBrandContext (INV-2) → resolveTemplate (template store) → generateText
 *   (facade: logs + retry) → content_item + content_generations history.
 * The template version is stamped on the item (prompt_version) for tracing.
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession } from "@/db/session";
import type { ProjectScope } from "./projects";
import { loadBrandContext } from "@/lib/context/context-loader";
import { generateText } from "@/lib/ai";
import { resolveTemplate } from "@/lib/ai/templates";
import { findViolations, formatByKey, splitDraft } from "@/lib/content/formats";

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

/** Generate 2–3 variants for a format; returns the new content_item id. */
export async function generateContent(
  scope: ProjectScope,
  input: { format: string; topic?: string; pillarId?: string | null; variants?: number; ideaId?: string | null },
): Promise<string> {
  const fmt = formatByKey(input.format);
  const context = await loadBrandContext(scope);
  const template = await resolveTemplate(scope, fmt.templateKey);
  const topic = (input.topic ?? "").trim();

  const result = await generateText(scope, {
    templateKey: template.key,
    systemTemplate: template.body,
    context,
    taskInput: `Format: ${fmt.label}\nTopic: ${topic}`,
    variants: Math.min(3, Math.max(2, input.variants ?? 2)),
    route: fmt.key === "hook_set" ? "cheap" : "strong",
  });

  const drafts = result.variants.map(splitDraft);
  const first = drafts[0];
  return withTenantSession(scope, async (c) => {
    const id = (
      await c.query<{ id: string }>(
        `INSERT INTO content_items
           (tenant_id, project_id, channel, format, topic, hook, body, cta, pillar_id, status,
            prompt_version, prompt_template_id, created_by)
         VALUES ($1,$12,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10,$11) RETURNING id`,
        [scope.tenantId, fmt.channel, fmt.key, topic || null, first.hook, first.body, first.cta,
         input.pillarId || null, template.version, template.id, scope.userId, scope.projectId],
      )
    ).rows[0].id;
    for (const [i, d] of drafts.entries()) {
      await c.query(
        `INSERT INTO content_generations
           (tenant_id, content_item_id, variant_index, hook, body, cta, prompt_version, model)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [scope.tenantId, id, i, d.hook, d.body, d.cta, template.version, result.model],
      );
    }
    return id;
  });
}

/** Regenerate with a steer; keeps every previous version in history (§4.2). */
export async function regenerateWithSteer(scope: ProjectScope, itemId: string, steer: string): Promise<void> {
  const item = (
    await withTenantSession(scope, (c) => c.query("SELECT * FROM content_items WHERE id=$1 AND project_id=$2", [itemId, scope.projectId]))
  ).rows[0];
  if (!item) throw new Error("content item not found");
  const fmt = formatByKey(item.format);
  const context = await loadBrandContext(scope);
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
}

/**
 * Partial edit from the canvas (inline text, drag to another pillar). Changing
 * the copy marks the piece "edited", so an approved piece needs approving
 * again; moving it between pillars keeps its status. The pillar must belong to
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
          AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM pillars WHERE id = $5::uuid AND project_id = $8))`,
      [patch.hook ?? null, patch.body ?? null, patch.cta ?? null, movePillar, patch.pillarId ?? null, copyChanged, itemId, scope.projectId],
    ),
  );
}

export async function deleteContent(scope: ProjectScope, itemId: string): Promise<void> {
  await withTenantSession(scope, (c) => c.query("DELETE FROM content_items WHERE id=$1 AND project_id=$2", [itemId, scope.projectId]));
}
