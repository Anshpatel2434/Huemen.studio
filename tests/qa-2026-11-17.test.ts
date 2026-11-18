/**
 * Regressions for what the 2026-11-17 multi-agent QA run found:
 *   - a row could point at ANOTHER workspace's pillar (single-column foreign
 *     keys ignore RLS), and that workspace's delete then changed this one's row
 *   - a stale edit panel silently wrote old text over a newer edit
 *   - signing out only cleared the browser's cookie (session_version)
 *   - redirects resolved against the server's own host (localRedirect)
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";
import { createProject, type ProjectScope } from "@/lib/data/projects";
import { ContentConflictError, generateContent, listContent, patchContent, updateContent } from "@/lib/data/content";
import { addCalendarEntry, captureIdea, createPillar, deletePillar, listIdeas, setIdeaPillar } from "@/lib/data/planning";
import { endSessions, getAccount } from "@/lib/data/auth";
import { localRedirect } from "@/lib/local-redirect";

const ADMIN = { tenantId: null, userId: null, isPlatformAdmin: true } as const;
let dbReachable = false;
let A: ProjectScope;
let B: ProjectScope;
let userId = "";

beforeAll(async () => {
  try {
    const probe = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await probe.query("SELECT 1");
    await probe.end();
    dbReachable = true;
  } catch {
    return;
  }
  const mk = async (name: string) => {
    const t = await withTenantSession(ADMIN, async (c) =>
      (await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name])).rows[0].id,
    );
    const w = { tenantId: t, userId: null, isPlatformAdmin: false };
    await withTenantSession(w, (c) => c.query(`INSERT INTO brand_profiles (tenant_id, project_id, status, niche) VALUES ($1, NULL, 'active', 'qa')`, [t]));
    return { ...w, projectId: await createProject(w, name) };
  };
  A = await mk("QA 11-17 A (test)");
  B = await mk("QA 11-17 B (test)");
  userId = await withTenantSession(ADMIN, async (c) =>
    (await c.query<{ id: string }>("INSERT INTO users (tenant_id, email, role, status) VALUES ($1, $2, 'client', 'active') RETURNING id", [A.tenantId, `qa1117-${Date.now()}@client.test`])).rows[0].id,
  );
});

afterAll(async () => {
  if (!dbReachable) return;
  await withTenantSession(ADMIN, (c) => c.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[A.tenantId, B.tenantId]]));
  await appPool().end();
});

describe("a row can only point at its own workspace's rows", () => {
  it("ignores another workspace's pillar on save, idea and calendar paths, and the database refuses it outright", async () => {
    if (!dbReachable) return;
    const mine = await createPillar(A, "Mine");
    const theirs = await createPillar(B, "Theirs");
    const itemId = await generateContent(A, { format: "linkedin_post", topic: "links" });
    const item = (await listContent(A)).find((i) => i.id === itemId)!;

    await updateContent(A, itemId, { hook: item.hook, body: item.body, cta: item.cta, pillarId: theirs, status: "edited" });
    expect((await listContent(A)).find((i) => i.id === itemId)!.pillarId).toBeNull();
    await updateContent(A, itemId, { hook: item.hook, body: item.body, cta: item.cta, pillarId: mine, status: "edited" });
    expect((await listContent(A)).find((i) => i.id === itemId)!.pillarId).toBe(mine);

    await captureIdea(A, "an idea about links");
    const idea = (await listIdeas(A))[0];
    await setIdeaPillar(A, idea.id, theirs);
    expect((await listIdeas(A))[0].pillarId).toBeNull();

    await addCalendarEntry(A, { date: "2030-01-02", pillarId: theirs, channel: "linkedin", topic: "t", hookAngle: "", cta: "" } as never);
    const cal = await withTenantSession(A, (c) => c.query<{ pillar_id: string | null }>("SELECT pillar_id FROM calendar_entries"));
    expect(cal.rows.every((r) => r.pillar_id === null)).toBe(true);

    // A raw write of A's own row naming B's pillar (the path that used to work):
    // RLS allows the row, the pair key refuses the reference.
    await expect(
      withTenantSession(A, (c) => c.query("UPDATE content_items SET pillar_id = $1 WHERE id = $2", [theirs, itemId])),
    ).rejects.toThrow(/content_items_pillar_tenant_fkey/);

    // B deleting its pillar changes nothing in A; A deleting its own clears only the pillar.
    await deletePillar(B, theirs);
    await deletePillar(A, mine);
    const after = (await listContent(A)).find((i) => i.id === itemId)!;
    expect(after.pillarId).toBeNull();
    expect(after.hook).toBe(item.hook);
  });
});

describe("a stale edit panel can't overwrite a newer edit", () => {
  it("saves against the copy it started from, and refuses when that copy changed", async () => {
    if (!dbReachable) return;
    const itemId = await generateContent(A, { format: "linkedin_post", topic: "two tabs" });
    const loaded = (await listContent(A)).find((i) => i.id === itemId)!;
    const base = { hook: loaded.hook, body: loaded.body, cta: loaded.cta };

    // Tab A saves first.
    await updateContent(A, itemId, { ...base, hook: "TAB A hook edit.", pillarId: null, status: "edited" }, base);
    // Tab B still holds the old copy.
    await expect(
      updateContent(A, itemId, { ...base, body: `${base.body}\nTAB B body line.`, pillarId: null, status: "edited" }, base),
    ).rejects.toBeInstanceOf(ContentConflictError);
    const now = (await listContent(A)).find((i) => i.id === itemId)!;
    expect(now.hook).toBe("TAB A hook edit.");
    expect(now.body).not.toContain("TAB B body line.");
  });
});

describe("a stale canvas edit or undo is refused too (round two)", () => {
  it("applies an inline edit only while the words it replaces are still there", async () => {
    if (!dbReachable) return;
    const itemId = await generateContent(A, { format: "linkedin_post", topic: "inline" });
    const loaded = (await listContent(A)).find((i) => i.id === itemId)!;
    await patchContent(A, itemId, { hook: "Fresh hook." }, { hook: loaded.hook });
    // A second canvas still showing the old hook, or an undo recorded before a rewrite.
    await expect(patchContent(A, itemId, { hook: "STALE hook." }, { hook: loaded.hook })).rejects.toBeInstanceOf(ContentConflictError);
    expect((await listContent(A)).find((i) => i.id === itemId)!.hook).toBe("Fresh hook.");
    // A pillar move carries no words and is not blocked.
    await patchContent(A, itemId, { pillarId: null }, {});
  });
});

describe("a workspace's own scope can read, not change, the admin-owned tables (round two)", () => {
  it("cannot promote itself, rename or re-status its workspace, or lift its caps", async () => {
    if (!dbReachable) return;
    const mine = { tenantId: A.tenantId, userId, isPlatformAdmin: false };
    const tried = await withTenantSession(mine, async (c) => [
      (await c.query("UPDATE users SET role = 'owner_admin' WHERE id = $1", [userId])).rowCount,
      (await c.query("UPDATE tenants SET name = 'Taken over', status = 'archived' WHERE id = $1", [A.tenantId])).rowCount,
      (await c.query("DELETE FROM admin_audit_log WHERE tenant_id = $1", [A.tenantId])).rowCount,
      (await c.query("SELECT 1 FROM users WHERE id = $1", [userId])).rowCount,
    ]);
    expect(tried).toEqual([0, 0, 0, 1]);
    await expect(
      withTenantSession(mine, (c) => c.query("INSERT INTO tenant_usage_caps (tenant_id) VALUES ($1)", [A.tenantId])),
    ).rejects.toThrow(/row-level security/);
    expect((await getAccount(userId))!.role).toBe("client");
  });
});

describe("signing out ends the session on the server", () => {
  it("raises the account's session version", async () => {
    if (!dbReachable) return;
    const before = (await getAccount(userId))!.sessionVersion;
    await endSessions(userId);
    expect((await getAccount(userId))!.sessionVersion).toBe(before + 1);
  });
});

describe("redirects stay on the browser's host", () => {
  it("sends a relative Location and never leaves the site", () => {
    expect(localRedirect("/auth/continue?token=x").headers.get("location")).toBe("/auth/continue?token=x");
    expect(localRedirect("/dashboard", 303).status).toBe(303);
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "evil"]) expect(localRedirect(bad).headers.get("location")).toBe("/");
  });
});
