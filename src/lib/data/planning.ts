/**
 * Pillars, idea inbox, calendar and offers (brief §4.2, §4.4, §4.5).
 *
 * All of these belong to the WORKSPACE, not to a piece (migration 0007): the
 * pillars a person writes from, the ideas they collect, what they sell and when
 * they publish do not change from one post to the next. They are set in
 * onboarding and every project draws on them, which is why each query filters
 * `project_id IS NULL` rather than on one project.
 *
 * Every query runs inside withTenantSession (INV-1).
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession } from "@/db/session";
import type { WorkspaceScope } from "./projects";

// ---------------------------------------------------------------- pillars ---

export interface PillarView {
  id: string;
  name: string;
  description: string | null;
  contentCount: number;
  ideaCount: number;
  calendarCount: number;
  formats: string[];
}

export async function listPillars(scope: WorkspaceScope): Promise<PillarView[]> {
  return withTenantSession(scope, async (c) => {
    const rows = (
      await c.query(
        `SELECT p.id, p.name, p.description,
                (SELECT count(*)::int FROM content_items ci WHERE ci.pillar_id = p.id) AS content_count,
                (SELECT count(*)::int FROM ideas i WHERE i.pillar_id = p.id) AS idea_count,
                (SELECT count(*)::int FROM calendar_entries e WHERE e.pillar_id = p.id) AS calendar_count,
                coalesce((SELECT array_agg(DISTINCT ci.format) FROM content_items ci WHERE ci.pillar_id = p.id), '{}') AS formats
           FROM pillars p WHERE p.project_id IS NULL ORDER BY p.sort_order, p.created_at`,
        [],
      )
    ).rows;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      contentCount: r.content_count,
      ideaCount: r.idea_count,
      calendarCount: r.calendar_count,
      formats: r.formats,
    }));
  });
}

export async function createPillar(scope: WorkspaceScope, name: string, description?: string): Promise<string> {
  return withTenantSession(scope, async (c) => {
    const bp = (await c.query("SELECT id FROM brand_profiles WHERE project_id IS NULL ORDER BY status='active' DESC, updated_at DESC LIMIT 1")).rows[0];
    const order = (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM pillars WHERE project_id IS NULL")).rows[0].n;
    const ins = await c.query<{ id: string }>(
      `INSERT INTO pillars (tenant_id, project_id, brand_profile_id, name, description, sort_order)
       VALUES ($1,NULL,$2,$3,$4,$5) RETURNING id`,
      [scope.tenantId, bp?.id ?? null, name, description || null, order],
    );
    return ins.rows[0].id;
  });
}

export async function updatePillar(scope: WorkspaceScope, id: string, name: string, description: string): Promise<void> {
  await withTenantSession(scope, (c) =>
    c.query("UPDATE pillars SET name=$1, description=$2 WHERE id=$3 AND project_id IS NULL", [name, description || null, id]),
  );
}

/** Canvas drag-to-reorder: `ids` is the new left-to-right order. Unknown ids are ignored. */
export async function reorderPillars(scope: WorkspaceScope, ids: string[]): Promise<void> {
  await withTenantSession(scope, (c) =>
    c.query(
      `UPDATE pillars p SET sort_order = o.pos
         FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, pos)
        WHERE p.id = o.id AND p.project_id IS NULL`,
      [ids],
    ),
  );
}

export async function deletePillar(scope: WorkspaceScope, id: string): Promise<void> {
  await withTenantSession(scope, (c) => c.query("DELETE FROM pillars WHERE id=$1 AND project_id IS NULL", [id]));
}

// ------------------------------------------------------------------ ideas ---

export interface IdeaView {
  id: string;
  rawText: string;
  source: string;
  status: string;
  pillarId: string | null;
  pillarName: string | null;
  convertedTo: string | null;
  createdAt: string;
}

/** Auto-tag: the pillar whose name words appear most in the idea (brief §4.5). */
export function autoTagPillar(text: string, pillars: { id: string; name: string }[]): string | null {
  const hay = text.toLowerCase();
  let best: { id: string; score: number } | null = null;
  for (const p of pillars) {
    const words = p.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    const score = words.filter((w) => hay.includes(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { id: p.id, score };
  }
  return best?.id ?? null;
}

export async function listIdeas(scope: WorkspaceScope): Promise<IdeaView[]> {
  return withTenantSession(scope, async (c) =>
    (
      await c.query(
        `SELECT i.*, p.name AS pillar_name FROM ideas i LEFT JOIN pillars p ON p.id = i.pillar_id
          WHERE i.project_id IS NULL AND i.status <> 'archived' ORDER BY i.created_at DESC`,
        [],
      )
    ).rows.map((r) => ({
      id: r.id,
      rawText: r.raw_text,
      source: r.source,
      status: r.status,
      pillarId: r.pillar_id,
      pillarName: r.pillar_name,
      convertedTo: r.converted_to_content_item_id,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  );
}

export async function captureIdea(scope: WorkspaceScope, text: string): Promise<void> {
  const pillars = await listPillars(scope);
  const pillarId = autoTagPillar(text, pillars);
  await withTenantSession(scope, (c) =>
    c.query(
      `INSERT INTO ideas (tenant_id, project_id, raw_text, source, pillar_id, created_by) VALUES ($1,NULL,$2,'paste',$3,$4)`,
      [scope.tenantId, text, pillarId, scope.userId],
    ),
  );
}

export async function setIdeaPillar(scope: WorkspaceScope, id: string, pillarId: string | null): Promise<void> {
  await withTenantSession(scope, (c) => c.query("UPDATE ideas SET pillar_id=$1 WHERE id=$2 AND project_id IS NULL", [pillarId, id]));
}

export async function archiveIdea(scope: WorkspaceScope, id: string): Promise<void> {
  await withTenantSession(scope, (c) => c.query("UPDATE ideas SET status='archived' WHERE id=$1 AND project_id IS NULL", [id]));
}

export async function markIdeaConverted(scope: WorkspaceScope, id: string, contentItemId: string): Promise<void> {
  await withTenantSession(scope, (c) =>
    c.query("UPDATE ideas SET status='converted', converted_to_content_item_id=$1 WHERE id=$2 AND project_id IS NULL", [contentItemId, id]),
  );
}

export async function getIdea(scope: WorkspaceScope, id: string) {
  return (await withTenantSession(scope, (c) => c.query("SELECT * FROM ideas WHERE id=$1 AND project_id IS NULL", [id]))).rows[0] as
    | { id: string; raw_text: string; pillar_id: string | null }
    | undefined;
}

// --------------------------------------------------------------- calendar ---

export interface CalendarEntryView {
  id: string;
  date: string; // YYYY-MM-DD
  pillarId: string | null;
  pillarName: string | null;
  channel: string | null;
  topic: string | null;
  hookAngle: string | null;
  cta: string | null;
  status: string;
  contentItemId: string | null;
}

export async function listCalendar(scope: WorkspaceScope, from: string, to: string): Promise<CalendarEntryView[]> {
  return withTenantSession(scope, async (c) =>
    (
      await c.query(
        `SELECT e.*, to_char(e.entry_date, 'YYYY-MM-DD') AS d, p.name AS pillar_name
           FROM calendar_entries e LEFT JOIN pillars p ON p.id = e.pillar_id
          WHERE e.project_id IS NULL AND e.entry_date BETWEEN $1 AND $2 ORDER BY e.entry_date`,
        [from, to],
      )
    ).rows.map((r) => ({
      id: r.id,
      date: r.d,
      pillarId: r.pillar_id,
      pillarName: r.pillar_name,
      channel: r.channel,
      topic: r.topic,
      hookAngle: r.hook_angle,
      cta: r.cta,
      status: r.status,
      contentItemId: r.content_item_id,
    })),
  );
}

export async function addCalendarEntry(
  scope: WorkspaceScope,
  e: { date: string; pillarId: string | null; channel: string; topic: string; hookAngle: string; cta: string },
): Promise<void> {
  await withTenantSession(scope, (c) =>
    c.query(
      `INSERT INTO calendar_entries (tenant_id, project_id, entry_date, pillar_id, channel, topic, hook_angle, cta)
       VALUES ($1,NULL,$2,$3,$4,$5,$6,$7)`,
      [scope.tenantId, e.date, e.pillarId, e.channel || null, e.topic || null, e.hookAngle || null, e.cta || null],
    ),
  );
}

export async function deleteCalendarEntry(scope: WorkspaceScope, id: string): Promise<void> {
  await withTenantSession(scope, (c) => c.query("DELETE FROM calendar_entries WHERE id=$1 AND project_id IS NULL", [id]));
}

// ----------------------------------------------------------------- offers ---

export interface OfferView {
  id: string;
  name: string;
  format: string | null;
  promise: string | null;
  deliverables: string[];
  pricingLogic: string | null;
}

export async function listOffers(scope: WorkspaceScope): Promise<OfferView[]> {
  return withTenantSession(scope, async (c) =>
    (await c.query("SELECT * FROM offers WHERE project_id IS NULL ORDER BY created_at DESC")).rows.map((r) => ({
      id: r.id,
      name: r.name,
      format: r.format,
      promise: r.promise,
      deliverables: r.deliverables ?? [],
      pricingLogic: r.pricing_logic_notes,
    })),
  );
}

export async function createOffer(
  scope: WorkspaceScope,
  o: { name: string; format: string; promise: string; deliverables: string[]; pricingLogic: string },
): Promise<void> {
  await withTenantSession(scope, (c) =>
    c.query(
      `INSERT INTO offers (tenant_id, project_id, name, format, promise, deliverables, pricing_logic_notes, created_by)
       VALUES ($1,NULL,$2,$3,$4,$5,$6,$7)`,
      [scope.tenantId, o.name, o.format || null, o.promise || null, JSON.stringify(o.deliverables), o.pricingLogic || null, scope.userId],
    ),
  );
}

export async function deleteOffer(scope: WorkspaceScope, id: string): Promise<void> {
  await withTenantSession(scope, (c) => c.query("DELETE FROM offers WHERE id=$1 AND project_id IS NULL", [id]));
}
