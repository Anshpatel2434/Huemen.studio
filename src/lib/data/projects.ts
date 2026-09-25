/**
 * Projects (migrations 0003, 0007).
 *
 * A project is ONE PIECE OF WORK — an Instagram post, a LinkedIn post — and it
 * runs Ideate → Content → Visual. The brand it is written from (brief, voice,
 * visual identity, pillars) lives above it at WORKSPACE level, set once in
 * onboarding, because none of that changes from one piece to the next.
 *
 * Every query is inside the tenant's RLS scope (INV-1); project_id groups rows
 * within that tenant, and a NULL project_id means the row belongs to the
 * workspace itself rather than to any one piece.
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession, type SessionScope } from "@/db/session";

import { STAGES, type Stage } from "@/lib/projects/stages";
import { formatByKey } from "@/lib/content/formats";
export { STAGES, type Stage };

/**
 * A scope on one workspace. Everything the brand owns — brief, pillars, offers,
 * ideas, calendar, the voice pack — reads and writes with this.
 */
export interface WorkspaceScope extends SessionScope {
  tenantId: string;
}

/** A workspace scope narrowed to one piece. Content and visuals take this. */
export interface ProjectScope extends WorkspaceScope {
  projectId: string;
}

export interface BriefAnswer {
  key: string;
  question: string;
  answer: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  stage: Stage;
  status: string;
  starred: boolean;
  briefAnswers: BriefAnswer[];
  /** What this piece is: the format it is for, and the take it argues. */
  format: string | null;
  channel: string | null;
  angle: string | null;
  ideaId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectCard extends ProjectRow {
  completeness: number;
  niche: string | null;
  palette: string[];
  pillarCount: number;
  contentCount: number;
  firstHook: string | null;
}

const toRow = (r: Record<string, unknown>): ProjectRow => ({
  id: r.id as string,
  name: r.name as string,
  description: (r.description as string) ?? null,
  stage: r.stage as Stage,
  status: r.status as string,
  starred: Boolean(r.starred),
  briefAnswers: (r.brief_answers as BriefAnswer[]) ?? [],
  format: (r.format as string) ?? null,
  channel: (r.channel as string) ?? null,
  angle: (r.angle as string) ?? null,
  ideaId: (r.idea_id as string) ?? null,
  createdAt: new Date(r.created_at as string).toISOString(),
  updatedAt: new Date(r.updated_at as string).toISOString(),
});

export async function listProjects(scope: SessionScope, opts: { archived?: boolean } = {}): Promise<ProjectCard[]> {
  return withTenantSession(scope, async (c) => {
    const rows = (
      await c.query(
        `SELECT p.*,
                bp.completeness, bp.niche, vi.palette,
                (SELECT count(*)::int FROM pillars x WHERE x.project_id = p.id) AS pillar_count,
                (SELECT count(*)::int FROM content_items x WHERE x.project_id = p.id) AS content_count,
                (SELECT hook FROM content_items x WHERE x.project_id = p.id ORDER BY created_at DESC LIMIT 1) AS first_hook
           FROM projects p
           LEFT JOIN LATERAL (
             SELECT id, completeness, niche FROM brand_profiles b WHERE b.project_id = p.id
              ORDER BY status='active' DESC, updated_at DESC LIMIT 1) bp ON true
           LEFT JOIN visual_identities vi ON vi.brand_profile_id = bp.id
          WHERE p.status = $1
          ORDER BY p.updated_at DESC`,
        [opts.archived ? "archived" : "active"],
      )
    ).rows;
    return rows.map((r) => ({
      ...toRow(r),
      completeness: r.completeness ?? 0,
      niche: r.niche ?? null,
      palette: (r.palette ?? []) as string[],
      pillarCount: r.pillar_count,
      contentCount: r.content_count,
      firstHook: r.first_hook ?? null,
    }));
  });
}

/** Resolve a project inside the tenant scope; null when it isn't visible (→ 404). */
export async function getProject(scope: SessionScope, projectId: string): Promise<ProjectRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return null;
  const r = (await withTenantSession(scope, (c) => c.query("SELECT * FROM projects WHERE id = $1", [projectId]))).rows[0];
  return r ? toRow(r) : null;
}

export async function createProject(scope: SessionScope, name: string, description?: string): Promise<string> {
  return withTenantSession(scope, async (c) =>
    (
      await c.query<{ id: string }>(
        `INSERT INTO projects (tenant_id, name, description, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
        [scope.tenantId, name, description || null, scope.userId],
      )
    ).rows[0].id,
  );
}

export async function renameProject(scope: ProjectScope, name: string): Promise<void> {
  await withTenantSession(scope, (c) => c.query("UPDATE projects SET name=$1 WHERE id=$2", [name, scope.projectId]));
}

export async function duplicateProjectBrief(scope: ProjectScope, name: string): Promise<string> {
  // New project seeded with a copy of this project's brief (voice + visual).
  return withTenantSession(scope, async (c) => {
    const id = (
      await c.query<{ id: string }>(
        `INSERT INTO projects (tenant_id, name, created_by) VALUES ($1,$2,$3) RETURNING id`,
        [scope.tenantId, name, scope.userId],
      )
    ).rows[0].id;
    const bp = (await c.query("SELECT * FROM brand_profiles WHERE project_id=$1 ORDER BY updated_at DESC LIMIT 1", [scope.projectId])).rows[0];
    if (bp) {
      const nb = (
        await c.query<{ id: string }>(
          `INSERT INTO brand_profiles (tenant_id, project_id, status, story_arc, positioning_statement, niche, audience, offers_summary, completeness)
           SELECT tenant_id, $1, status, story_arc, positioning_statement, niche, audience, offers_summary, completeness
             FROM brand_profiles WHERE id=$2 RETURNING id`,
          [id, bp.id],
        )
      ).rows[0].id;
      await c.query(
        `INSERT INTO voice_guides (tenant_id, brand_profile_id, tone_descriptors, do_words, dont_words, sample_posts, reading_level, formatting_rules)
         SELECT tenant_id, $1, tone_descriptors, do_words, dont_words, sample_posts, reading_level, formatting_rules FROM voice_guides WHERE brand_profile_id=$2`,
        [nb, bp.id],
      );
      await c.query(
        `INSERT INTO visual_identities (tenant_id, brand_profile_id, palette, fonts, image_style_notes, aspect_ratio_defaults)
         SELECT tenant_id, $1, palette, fonts, image_style_notes, aspect_ratio_defaults FROM visual_identities WHERE brand_profile_id=$2`,
        [nb, bp.id],
      );
    }
    return id;
  });
}

export async function setProjectStar(scope: ProjectScope, starred: boolean): Promise<void> {
  // A pin, not an edit: the projects trigger (0005) leaves updated_at alone.
  await withTenantSession(scope, (c) =>
    c.query("UPDATE projects SET starred=$1 WHERE id=$2", [starred, scope.projectId]),
  );
}

export async function restoreProject(scope: ProjectScope): Promise<void> {
  await withTenantSession(scope, (c) => c.query("UPDATE projects SET status='active' WHERE id=$1", [scope.projectId]));
}

export async function archiveProject(scope: ProjectScope): Promise<void> {
  await withTenantSession(scope, (c) => c.query("UPDATE projects SET status='archived' WHERE id=$1", [scope.projectId]));
}

/**
 * Permanently delete a project. Its brief, pillars, content (with history),
 * visuals, ideas, calendar and offers go with it (ON DELETE CASCADE).
 * generation_logs rows stay for usage and audit (their content link is
 * nulled). Stored files are removed after the rows, best effort: a leftover
 * file is harmless, a missing row is not.
 */
export async function deleteProject(scope: ProjectScope): Promise<boolean> {
  const keys = await withTenantSession(scope, async (c) => {
    const files = (
      await c.query<{ storage_key: string }>(
        `SELECT storage_key FROM assets WHERE project_id=$1 AND storage_key IS NOT NULL
         UNION SELECT storage_key FROM image_assets WHERE project_id=$1 AND storage_key IS NOT NULL`,
        [scope.projectId],
      )
    ).rows.map((r) => r.storage_key);
    const del = await c.query("DELETE FROM projects WHERE id=$1", [scope.projectId]);
    return del.rowCount ? files : null;
  });
  if (!keys) return false;
  const { storage } = await import("@/lib/storage");
  await Promise.allSettled(keys.map((k) => storage().delete(k)));
  return true;
}

/** Unlock a step. Only ever moves forward, one step at a time. */
export async function unlockStage(scope: ProjectScope, to: Stage): Promise<void> {
  await withTenantSession(scope, async (c) => {
    const cur = (await c.query<{ stage: Stage }>("SELECT stage FROM projects WHERE id=$1", [scope.projectId])).rows[0]?.stage;
    if (!cur) throw new Error("project not found");
    const ci = STAGES.indexOf(cur), ti = STAGES.indexOf(to);
    if (ti <= ci) return;
    if (ti !== ci + 1) throw new Error(`cannot skip from ${cur} to ${to}`);
    await c.query("UPDATE projects SET stage=$1 WHERE id=$2", [to, scope.projectId]);
  });
}

/**
 * The Ideate step's whole output: what this piece is for, which pillar it sits
 * under, and the angle it takes. Anything left blank is left as it was, so
 * saving one field never clears another.
 */
export async function setIdeate(
  scope: ProjectScope,
  v: { format: string | null; pillarId: string | null; angle: string | null; ideaId: string | null; topic: string },
): Promise<void> {
  await withTenantSession(scope, async (c) => {
    await c.query(
      `UPDATE projects
          SET format  = COALESCE($1, format),
              channel = COALESCE($2, channel),
              angle   = COALESCE($3, angle),
              idea_id = COALESCE($4::uuid, idea_id),
              name    = CASE WHEN $5 <> '' THEN left($5, 120) ELSE name END
        WHERE id = $6`,
      [v.format, v.format ? formatByKey(v.format).channel : null, v.angle, v.ideaId, v.topic, scope.projectId],
    );
    // The pillar lives on the piece's content once it exists; until then the
    // idea link carries it.
    if (v.pillarId) {
      await c.query(
        `UPDATE content_items SET pillar_id = $1
          WHERE project_id = $2
            AND EXISTS (SELECT 1 FROM pillars WHERE id = $1 AND project_id IS NULL)`,
        [v.pillarId, scope.projectId],
      );
    }
  });
}

export async function saveBriefAnswers(scope: ProjectScope, answers: BriefAnswer[]): Promise<void> {
  await withTenantSession(scope, (c) =>
    c.query("UPDATE projects SET brief_answers=$1 WHERE id=$2", [JSON.stringify(answers), scope.projectId]),
  );
}

export async function touchProject(scope: ProjectScope): Promise<void> {
  await withTenantSession(scope, (c) => c.query("UPDATE projects SET updated_at=now() WHERE id=$1", [scope.projectId]));
}

