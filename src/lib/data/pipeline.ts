/**
 * Generation, in two tiers (migration 0007).
 *
 * ONBOARDING, once per workspace: pillars, generated from the brief and the
 * strategy answers. They are the brand's, not any one piece's.
 *
 * PER PIECE: content, then visuals. Each unlocks the next step of that project
 * (projects.stage: ideate → content → visual).
 *
 * All generation goes through the AI facade with the one versioned brand
 * context (INV-2) and is logged; every write is tenant-scoped (INV-1).
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession } from "@/db/session";
import { loadBrandContext } from "@/lib/context/context-loader";
import { generateText } from "@/lib/ai";
import { resolveTemplate } from "@/lib/ai/templates";
import { formatByKey } from "@/lib/content/formats";
import { generateContent, listContent } from "./content";
import { createPillar, listPillars } from "./planning";
import { getProject, unlockStage, type ProjectScope, type WorkspaceScope } from "./projects";
import { loadBriefAnswers } from "./foundation";

/** Parse "Name :: description" lines (the pillar_set template's output shape). */
export function parsePillarLines(text: string): { name: string; description: string }[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((l) => l.includes("::"))
    .map((l) => {
      const [name, ...rest] = l.split("::");
      return { name: name.trim(), description: rest.join("::").trim() };
    })
    .filter((p) => p.name.length > 1 && p.name.length <= 60);
}

/**
 * Onboarding: the workspace's pillars, generated from the brief and the
 * strategy answers. Not tied to a project — every piece written afterwards
 * draws on them.
 */
export async function generatePillars(scope: WorkspaceScope, opts: { count?: number; focus?: string } = {}): Promise<number> {
  const context = await loadBrandContext(scope);
  const template = await resolveTemplate(scope, "pillar_set");
  const answers = (await loadBriefAnswers(scope)).map((a) => `${a.key}: ${a.answer}`).join("\n");
  const result = await generateText(scope, {
    templateKey: template.key,
    systemTemplate: template.body,
    context,
    taskInput: [
      `Propose ${opts.count ?? "3–5"} content pillars as "Name :: one-line description".`,
      `Count: ${opts.count ?? 5}`,
      opts.focus?.trim() ? `Focus: ${opts.focus.trim()}` : "",
      `Strategy answers:\n${answers}`,
    ].filter(Boolean).join("\n"),
    variants: 1,
    route: "strong",
  });
  const existing = new Set((await listPillars(scope)).map((p) => p.name.toLowerCase()));
  const fresh = parsePillarLines(result.variants[0]).filter((p) => !existing.has(p.name.toLowerCase()));
  for (const p of fresh) await createPillar(scope, p.name, p.description);
  return fresh.length;
}

const ANGLES = ["the mistake most people make", "a story from the work", "a simple framework", "what I'd do differently"];

/** Step 3: content drafted from each pillar (2 variants per piece, history kept). */
export async function generateContentFromPillars(
  scope: ProjectScope,
  opts: { perPillar: number; format: string; onlyEmpty: boolean },
): Promise<number> {
  const pillars = await listPillars(scope);
  if (pillars.length === 0) throw new Error("no pillars yet");
  let made = 0;
  // Sequential on purpose: each call is logged and a failure keeps what's done
  // (partial results retained). Large batches belong on the job queue (P2-4).
  for (const p of pillars) {
    if (opts.onlyEmpty && p.contentCount > 0) continue;
    for (let i = 0; i < opts.perPillar; i++) {
      const angle = ANGLES[(i + made) % ANGLES.length];
      const topic = `${p.name} — ${angle}`;
      await generateContent(scope, { format: opts.format, topic, pillarId: p.id });
      made++;
    }
  }
  if (made > 0) await unlockStage(scope, "content");
  return made;
}

export interface VisualRow {
  id: string;
  contentItemId: string;
  kind: string;
  scheme: number;
  width: number;
  height: number;
  createdAt: string;
}

/**
 * Step 4: a visual set per content piece — post image, quote card and carousel
 * frames — rendered as templates with REAL text over brand colours (brief §09
 * default; image models misrender text). Rows are recorded in image_assets.
 */
export async function generateVisuals(scope: ProjectScope, opts: { scheme: number; approvedOnly: boolean }): Promise<number> {
  const items = (await listContent(scope)).filter((c) => (opts.approvedOnly ? c.status === "approved" : true));
  if (items.length === 0) throw new Error("no content to design");
  await withTenantSession(scope, async (c) => {
    for (const it of items) {
      await c.query("DELETE FROM image_assets WHERE content_item_id=$1 AND project_id=$2", [it.id, scope.projectId]);
      const f = formatByKey(it.format).frame;
      const rows: [string, number, number][] = [["single", f.w, f.h], ["quote_card", 1080, 1080], ["carousel_frame", 1080, 1350]];
      for (const [kind, w, h] of rows) {
        await c.query(
          `INSERT INTO image_assets (tenant_id, project_id, content_item_id, kind, prompt, model, params, aspect_ratio, width, height, status, created_by)
           VALUES ($1,$2,$3,$4,$5,'template',$6,$7,$8,$9,'ready',$10)`,
          [scope.tenantId, scope.projectId, it.id, kind, it.hook, JSON.stringify({ scheme: opts.scheme }), `${w}:${h}`, w, h, scope.userId],
        );
      }
    }
  });
  await unlockStage(scope, "visual");
  return items.length;
}

export async function listVisuals(scope: ProjectScope): Promise<VisualRow[]> {
  return withTenantSession(scope, async (c) =>
    (
      await c.query(
        `SELECT id, content_item_id, kind, params, width, height, created_at FROM image_assets
          WHERE project_id=$1 AND content_item_id IS NOT NULL ORDER BY created_at`,
        [scope.projectId],
      )
    ).rows.map((r) => ({
      id: r.id,
      contentItemId: r.content_item_id,
      kind: r.kind,
      scheme: Number(r.params?.scheme ?? 0),
      width: r.width,
      height: r.height,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  );
}
