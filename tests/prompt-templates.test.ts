/**
 * Prompt templates are data (brief §05, TASKS P2-2 / P3-10): an admin saves a
 * new version without a redeploy, the next draft resolves it, a workspace
 * override wins only in that workspace, and the version is stamped on what
 * it wrote.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";
import { createProject, type ProjectScope } from "@/lib/data/projects";
import { generateContent, listContent } from "@/lib/data/content";
import { listTemplateVersions, saveTemplate } from "@/lib/data/admin";
import { resolveTemplate } from "@/lib/ai/templates";
import { TEMPLATE_CATALOG, templateDefault } from "@/lib/ai/template-defaults";
import type { Session } from "@/lib/auth/types";

let dbReachable = false;
let A: ProjectScope;
let B: ProjectScope;
let admin: Session;
const KEY = "talk_abstract"; // not seeded, so the default is what runs first

beforeAll(async () => {
  try {
    const probe = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await probe.query("SELECT 1");
    await probe.end();
    dbReachable = true;
  } catch {
    return;
  }
  const root = { tenantId: null, userId: null, isPlatformAdmin: true };
  const mk = (name: string) =>
    withTenantSession(root, async (c) => (await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name])).rows[0].id);
  const [ta, tb, owner] = [await mk("Tpl A (test)"), await mk("Tpl B (test)"), await mk("Tpl owner (test)")];
  const adminId = await withTenantSession(root, async (c) =>
    (await c.query<{ id: string }>("INSERT INTO users (tenant_id, email, role, status) VALUES ($1,'tpl-admin@test.local','owner_admin','active') RETURNING id", [owner])).rows[0].id,
  );
  admin = { userId: adminId, tenantId: owner, role: "owner_admin", email: "tpl-admin@test.local" };
  // Any global rows for KEY left by an earlier run would make the versions start higher; clear them.
  await withTenantSession(root, (c) => c.query("DELETE FROM prompt_templates WHERE key=$1 AND tenant_id IS NULL", [KEY]));
  const wa = { tenantId: ta, userId: null, isPlatformAdmin: false };
  const wb = { tenantId: tb, userId: null, isPlatformAdmin: false };
  A = { ...wa, projectId: await createProject(wa, "A") };
  B = { ...wb, projectId: await createProject(wb, "B") };
});

afterAll(async () => {
  if (!dbReachable) return;
  await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, async (c) => {
    await c.query("DELETE FROM prompt_templates WHERE key=$1 AND tenant_id IS NULL", [KEY]);
    await c.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[A.tenantId, B.tenantId, admin.tenantId]]);
  });
  await appPool().end();
});

describe("the catalogue", () => {
  it("names every format and task template once, each with a default body", () => {
    const keys = TEMPLATE_CATALOG.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ["linkedin_post", "pillar_set", "topic_proposals", "calendar_plan", "voice_judge"]) expect(keys).toContain(k);
    for (const t of TEMPLATE_CATALOG) expect(t.defaultBody.length).toBeGreaterThan(20);
    expect(templateDefault("nope")).toBeNull();
  });
});

describe("templates as data", () => {
  it("resolves the default at v0, then each saved version, and stamps the piece", async () => {
    if (!dbReachable) return;
    const before = await resolveTemplate(A, KEY);
    expect(before.version).toBe(0);
    expect(before.id).toBeNull();
    expect(before.body).toBe(templateDefault(KEY));

    expect(await saveTemplate(admin, { key: KEY, body: "Version one: write it for the ear.", tenantId: null })).toBe(1);
    expect(await saveTemplate(admin, { key: KEY, body: "Version two: shorter, and promise one thing.", tenantId: null })).toBe(2);
    const now = await resolveTemplate(A, KEY);
    expect(now.version).toBe(2);
    expect(now.body).toMatch(/^Version two/);

    const id = await generateContent(A, { format: KEY, topic: "stamping" });
    const item = (await listContent(A)).find((c) => c.id === id)!;
    expect(item.promptVersion).toBe(2);

    const listed = (await listTemplateVersions(admin)).filter((v) => v.key === KEY);
    expect(listed.map((v) => v.version)).toEqual([2, 1]);
    expect(listed[0].createdBy).toBe("tpl-admin@test.local");
  });

  it("a workspace override wins only in that workspace", async () => {
    if (!dbReachable) return;
    expect(await saveTemplate(admin, { key: KEY, body: "Only for A: open with a story.", tenantId: A.tenantId })).toBe(1);
    expect((await resolveTemplate(A, KEY)).body).toMatch(/^Only for A/);
    expect((await resolveTemplate(B, KEY)).body).toMatch(/^Version two/);
    // A later global version does not out-rank A's override.
    await saveTemplate(admin, { key: KEY, body: "Version three.", tenantId: null });
    expect((await resolveTemplate(A, KEY)).body).toMatch(/^Only for A/);
    expect((await resolveTemplate(B, KEY)).version).toBe(3);
  });

  it("refuses an empty body", async () => {
    if (!dbReachable) return;
    await expect(saveTemplate(admin, { key: KEY, body: "   ", tenantId: null })).rejects.toThrow();
  });
});
