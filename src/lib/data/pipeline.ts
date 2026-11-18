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
import { userMessage } from "@/lib/ai/errors";
import { resolveTemplate } from "@/lib/ai/templates";
import { formatByKey, formatUsesCarousel } from "@/lib/content/formats";
import { generateContent, listContent } from "./content";
import { createPillar, listPillars } from "./planning";
import { getProject, unlockStage, type ProjectScope, type WorkspaceScope } from "./projects";
import { loadBriefAnswers } from "./foundation";
import { parseDesign, type Design } from "@/lib/visual/design";
import { SCHEME_ORDER } from "@/lib/visual/schemes";

/**
 * Parse "Name :: description" lines (the pillar_set template's output shape),
 * and say which non-blank lines were not in that form (audit L5): a line that
 * is dropped is named, not lost.
 */
export function parsePillarReport(text: string): { pillars: { name: string; description: string }[]; dropped: string[] } {
  const pillars: { name: string; description: string }[] = [];
  const dropped: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
    if (!line) continue;
    const at = line.indexOf("::");
    const name = at < 0 ? "" : line.slice(0, at).trim();
    if (at < 0 || name.length <= 1 || name.length > 60) {
      dropped.push(line);
      continue;
    }
    pillars.push({ name, description: line.slice(at + 2).trim() });
  }
  return { pillars, dropped };
}

export function parsePillarLines(text: string): { name: string; description: string }[] {
  return parsePillarReport(text).pillars;
}

/** What a pillar run did: how many were added, which lines were skipped, and the plain reason when it added nothing. */
export interface PillarRun {
  added: number;
  dropped: string[];
  note: string | null;
}

/**
 * Onboarding: the workspace's pillars, generated from the brief and the
 * strategy answers. Not tied to a project — every piece written afterwards
 * draws on them. A run that adds nothing, or skips lines, says so (audit L5).
 */
export async function generatePillars(scope: WorkspaceScope, opts: { count?: number; focus?: string } = {}): Promise<PillarRun> {
  const context = await loadBrandContext(scope);
  const template = await resolveTemplate(scope, "pillar_set");
  const result = await generateText(scope, {
    templateKey: template.key,
    systemTemplate: template.body,
    context,
    taskInput: [
      `Propose ${opts.count ?? "3–5"} content pillars as "Name :: one-line description".`,
      `Count: ${opts.count ?? 5}`,
      opts.focus?.trim() ? `Focus: ${opts.focus.trim()}` : "",
      // The strategy answers are in the context block (INV-2).
    ].filter(Boolean).join("\n"),
    variants: 1,
    route: "strong",
  });
  const existing = new Set((await listPillars(scope)).map((p) => p.name.toLowerCase()));
  const { pillars, dropped } = parsePillarReport(result.variants[0]);
  const fresh = pillars.filter((p) => !existing.has(p.name.toLowerCase()));
  for (const p of fresh) await createPillar(scope, p.name, p.description);
  const notes: string[] = [];
  if (pillars.length === 0) notes.push("The reply did not list any pillars in the form Name :: description, so none were added.");
  else if (fresh.length === 0) notes.push("Every pillar proposed already exists in this workspace, so none were added.");
  if (dropped.length) {
    notes.push(`${dropped.length === 1 ? "One line was" : `${dropped.length} lines were`} not in the Name :: description form and ${dropped.length === 1 ? "was" : "were"} skipped.`);
  }
  return { added: fresh.length, dropped, note: notes.length ? notes.join(" ") : null };
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
  /** The scheme's index as stored. Read it through lib/visual/schemes `schemeIndex` with `schemeOrder`. */
  scheme: number;
  /** Which ordering of schemes the index counts in (1: before the [ground, accent, ink] order; 2: now). */
  schemeOrder: number;
  /** Layouts and tweaks (lib/visual/design), the same on every row of a piece. */
  design: Design;
  width: number;
  height: number;
  createdAt: string;
}

/**
 * Step 4: a visual set per content piece — post image and quote card, plus
 * carousel frames for the carousel formats (formatUsesCarousel) — rendered as
 * templates with REAL text over brand colours (brief §09 default; image models
 * misrender text). Rows are recorded in image_assets.
 */
export async function generateVisuals(scope: ProjectScope, opts: { scheme: number; approvedOnly: boolean }): Promise<number> {
  const items = (await listContent(scope)).filter((c) => (opts.approvedOnly ? c.status === "approved" : true));
  if (items.length === 0) throw new Error("no content to design");
  await withTenantSession(scope, async (c) => {
    for (const it of items) {
      // A regenerate redraws with a new scheme; the layouts and tweaks the
      // person chose for this piece carry over.
      const kept = (
        await c.query<{ params: Record<string, unknown> }>(
          "SELECT params FROM image_assets WHERE content_item_id=$1 AND project_id=$2 AND kind <> 'picture' ORDER BY created_at LIMIT 1",
          [it.id, scope.projectId],
        )
      ).rows[0]?.params;
      const design = parseDesign(kept);
      // Pictures stay: a regenerate redraws the templates, not the pictures they
      // carry. Each template row is updated IN PLACE (same id), so the comments
      // pinned to it survive; deleting and re-inserting cascaded them away
      // (2026-11-17 test). A missing kind is inserted.
      const f = formatByKey(it.format).frame;
      const rows: [string, number, number][] = [["single", f.w, f.h], ["quote_card", 1080, 1080]];
      // Carousel frames only for the formats that are carousels. Rows an older
      // run made for other formats are left as they are (no data is deleted).
      if (formatUsesCarousel(it.format)) rows.push(["carousel_frame", 1080, 1350]);
      // The scheme is an index into lib/visual/schemes; the order it counts in is stamped beside it.
      const params = JSON.stringify({ scheme: opts.scheme, schemeOrder: SCHEME_ORDER, ...design });
      for (const [kind, w, h] of rows) {
        const updated = await c.query(
          `UPDATE image_assets SET prompt=$1, params=$2, aspect_ratio=$3, width=$4, height=$5, status='ready'
            WHERE content_item_id=$6 AND project_id=$7 AND kind=$8`,
          [it.hook, params, `${w}:${h}`, w, h, it.id, scope.projectId, kind],
        );
        if (updated.rowCount) continue;
        await c.query(
          `INSERT INTO image_assets (tenant_id, project_id, content_item_id, kind, prompt, model, params, aspect_ratio, width, height, status, created_by)
           VALUES ($1,$2,$3,$4,$5,'template',$6,$7,$8,$9,'ready',$10)`,
          [scope.tenantId, scope.projectId, it.id, kind, it.hook, params, `${w}:${h}`, w, h, scope.userId],
        );
      }
    }
  });
  await unlockStage(scope, "visual");
  return items.length;
}

/**
 * Save how a piece's visuals are designed (layouts, tweaks), and optionally
 * its scheme. Written onto every row of the piece. Returns false when the
 * piece has no visuals in this project.
 */
export async function saveDesign(scope: ProjectScope, contentItemId: string, design: Design, scheme?: number): Promise<boolean> {
  // Pictures are set only by lib/data/pictures: a design saved from the board
  // (possibly from before a picture job finished) never overwrites them.
  const { pictures: _ignored, ...clean } = parseDesign(design);
  void _ignored;
  const patch = scheme === undefined ? clean : { ...clean, scheme: Math.max(0, Math.floor(scheme)), schemeOrder: SCHEME_ORDER };
  return withTenantSession(scope, async (c) =>
    ((await c.query("UPDATE image_assets SET params = params || $1::jsonb WHERE content_item_id=$2 AND project_id=$3 AND kind <> 'picture'", [JSON.stringify(patch), contentItemId, scope.projectId])).rowCount ?? 0) > 0,
  );
}

/** Remove one piece's visual set, its pictures included. The copy stays; only the artboards go. */
export async function deleteVisuals(scope: ProjectScope, contentItemId: string): Promise<number> {
  const { n, keys } = await withTenantSession(scope, async (c) => {
    const keys = (
      await c.query<{ storage_key: string }>(
        "SELECT storage_key FROM image_assets WHERE content_item_id=$1 AND project_id=$2 AND storage_key IS NOT NULL",
        [contentItemId, scope.projectId],
      )
    ).rows.map((r) => r.storage_key);
    const del = await c.query("DELETE FROM image_assets WHERE content_item_id=$1 AND project_id=$2 AND kind <> 'picture'", [contentItemId, scope.projectId]);
    await c.query("DELETE FROM image_assets WHERE content_item_id=$1 AND project_id=$2 AND kind = 'picture'", [contentItemId, scope.projectId]);
    return { n: del.rowCount ?? 0, keys };
  });
  if (keys.length) {
    const { storage } = await import("@/lib/storage");
    await Promise.allSettled(keys.map((k) => storage().delete(k)));
  }
  return n;
}

export async function listVisuals(scope: ProjectScope): Promise<VisualRow[]> {
  return withTenantSession(scope, async (c) =>
    (
      await c.query(
        `SELECT id, content_item_id, kind, params, width, height, created_at FROM image_assets
          WHERE project_id=$1 AND content_item_id IS NOT NULL AND kind <> 'picture' ORDER BY created_at`,
        [scope.projectId],
      )
    ).rows.map((r) => ({
      id: r.id,
      contentItemId: r.content_item_id,
      kind: r.kind,
      scheme: Number(r.params?.scheme ?? 0),
      schemeOrder: Number(r.params?.schemeOrder ?? 1),
      design: parseDesign(r.params),
      width: r.width,
      height: r.height,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  );
}

/**
 * generatePillars for a form action: the reason it failed (the plain message a
 * person sees), or null when it worked. Pages that generate pillars save the
 * person's answers first, then send them back with this reason and Try again
 * (components/generation-failed) instead of an error page (P2-3).
 */
export async function tryGeneratePillars(scope: WorkspaceScope, opts: { count?: number; focus?: string } = {}): Promise<string | null> {
  try {
    const run = await generatePillars(scope, opts);
    // Nothing added, or lines skipped: the person is told why, not left with a silent zero (audit L5).
    return run.added === 0 || run.dropped.length ? run.note : null;
  } catch (e) {
    return userMessage(e);
  }
}
