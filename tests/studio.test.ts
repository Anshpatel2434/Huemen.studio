/**
 * Cross-tenant tests for the studio data paths added with the workspace UI
 * (content generation + history, pillars, ideas, calendar, offers, usage logs).
 * Tenant A writes through the real feature functions; tenant B must read
 * nothing back and must not be able to mutate A's rows (INV-1).
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { withTenantSession } from "@/db/session";
import { createProject, deleteProject, getProject, unlockStage, type ProjectScope } from "@/lib/data/projects";
import { generateContentFromPillars, generateVisuals, listVisuals, parsePillarLines } from "@/lib/data/pipeline";
import { appPool } from "@/db/pool";
import { generateContent, listContent, patchContent, updateContent } from "@/lib/data/content";
import { captureIdea, createOffer, createPillar, listIdeas, listOffers, listPillars, addCalendarEntry, listCalendar, reorderPillars } from "@/lib/data/planning";
import { loadUsage } from "@/lib/data/insights";

let dbReachable = false;
let A: ProjectScope;
let B: ProjectScope;
let A2: ProjectScope; // a second project in tenant A

async function makeTenant(name: string): Promise<string> {
  return withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, async (c) =>
    (await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name])).rows[0].id,
  );
}

beforeAll(async () => {
  try {
    const probe = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await probe.query("SELECT 1");
    await probe.end();
    dbReachable = true;
  } catch {
    return;
  }
  const ta = await makeTenant("Studio A (test)");
  const tb = await makeTenant("Studio B (test)");
  const wa = { tenantId: ta, userId: null, isPlatformAdmin: false };
  const wb = { tenantId: tb, userId: null, isPlatformAdmin: false };
  A = { ...wa, projectId: await createProject(wa, "A project") };
  A2 = { ...wa, projectId: await createProject(wa, "A second project") };
  B = { ...wb, projectId: await createProject(wb, "B project") };
});

afterAll(async () => {
  if (!dbReachable) return;
  await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, (c) =>
    c.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[A.tenantId, B.tenantId]]),
  );
  await appPool().end();
});

describe("studio data paths are tenant-isolated", () => {
  it("content, history and logs written by A are invisible to B", async () => {
    if (!dbReachable) return;
    const id = await generateContent(A, { format: "linkedin_post", topic: "isolation" });
    const a = await listContent(A);
    expect(a.map((c) => c.id)).toContain(id);
    expect(a.find((c) => c.id === id)!.history.length).toBe(2);
    expect(await listContent(B)).toEqual([]);
    expect((await loadUsage(A)).textThisMonth).toBeGreaterThan(0);
    expect((await loadUsage(B)).textThisMonth).toBe(0);

    // B cannot update A's item even with its id.
    await updateContent(B, id, { hook: "pwned", body: "", cta: "", pillarId: null, status: "approved" });
    expect((await listContent(A)).find((c) => c.id === id)!.hook).not.toBe("pwned");
  });

  it("pillars, ideas, calendar and offers written by A are invisible to B", async () => {
    if (!dbReachable) return;
    await createPillar(A, "Behind the scenes");
    await captureIdea(A, "A behind the scenes story");
    await addCalendarEntry(A, { date: "2026-10-01", pillarId: null, channel: "linkedin", topic: "t", hookAngle: "", cta: "" });
    await createOffer(A, { name: "Cohort", format: "", promise: "", deliverables: ["x"], pricingLogic: "" });

    expect((await listPillars(A)).length).toBe(1);
    const ideas = await listIdeas(A);
    expect(ideas[0].pillarId).toBe((await listPillars(A))[0].id); // auto-tagged
    expect((await listCalendar(A, "2026-01-01", "2026-12-31")).length).toBe(1);
    expect((await listOffers(A)).length).toBe(1);

    expect(await listPillars(B)).toEqual([]);
    expect(await listIdeas(B)).toEqual([]);
    expect(await listCalendar(B, "2026-01-01", "2026-12-31")).toEqual([]);
    expect(await listOffers(B)).toEqual([]);
  });
});

describe("projects", () => {
  it("B cannot resolve A's project, even by id", async () => {
    if (!dbReachable) return;
    expect(await getProject({ tenantId: B.tenantId, userId: null, isPlatformAdmin: false }, A.projectId)).toBeNull();
    // A B-scope reads none of A's pillars: RLS keys on tenant, and pillars are
    // now the WORKSPACE's rather than any one project's.
    expect(await listPillars(B)).toEqual([]);
  });

  it("pillars are shared across a workspace; content stays with its own piece", async () => {
    if (!dbReachable) return;
    // Migration 0007: one brand per workspace, so both projects see the same
    // pillars. A piece's content belongs to that piece alone.
    await createPillar(A, "Shared pillar");
    expect((await listPillars(A2)).map((p) => p.name)).toContain("Shared pillar");
    expect(await listContent(A2)).toEqual([]);
  });

  it("steps unlock in order and never skip", async () => {
    if (!dbReachable) return;
    await expect(unlockStage(A2, "visual")).rejects.toThrow(/skip/);
    await unlockStage(A2, "content");
    await createPillar(A2, "Only pillar");
    // Pillars are the workspace's, so a run drafts from every one of them.
    const pillarCount = (await listPillars(A2)).length;
    expect(await generateContentFromPillars(A2, { perPillar: 1, format: "linkedin_post", onlyEmpty: true }))
      .toBe(pillarCount);
    expect(await generateVisuals(A2, { scheme: 1, approvedOnly: false })).toBe(pillarCount);
    expect((await getProject(A2, A2.projectId))!.stage).toBe("visual");
    expect((await listVisuals(A2)).length).toBe(pillarCount * 3);
    expect(await listVisuals(B)).toEqual([]);
  });

  it("canvas edits: reorder pillars and patch copy/pillar in place, scoped to the project", async () => {
    if (!dbReachable) return;
    const x = await createPillar(A2, "Second");
    const y = await createPillar(A2, "Third");
    const rest = (await listPillars(A2)).map((p) => p.id).filter((id) => id !== x && id !== y);
    const order = [y, ...rest, x];
    await reorderPillars(A2, order);
    expect((await listPillars(A2)).map((p) => p.id)).toEqual(order);
    // Another tenant naming these ids changes nothing.
    await reorderPillars(B, [x, y, ...rest]);
    expect((await listPillars(A2)).map((p) => p.id)).toEqual(order);

    const item = (await listContent(A2))[0];
    await patchContent(A2, item.id, { hook: "Edited on the canvas" });
    let now = (await listContent(A2)).find((c) => c.id === item.id)!;
    expect(now.hook).toBe("Edited on the canvas");
    expect(now.body).toBe(item.body); // untouched fields stay
    expect(now.status).toBe("edited");

    await patchContent(A2, item.id, { pillarId: y });
    now = (await listContent(A2)).find((c) => c.id === item.id)!;
    expect(now.pillarId).toBe(y);

    // Pillars are the workspace's, so one created from another project in the
    // same workspace is a legitimate home for this piece (migration 0007).
    const sibling = await createPillar(A, "Also this workspace");
    await patchContent(A2, item.id, { pillarId: sibling });
    expect((await listContent(A2)).find((c) => c.id === item.id)!.pillarId).toBe(sibling);

    // A pillar belonging to another WORKSPACE is still refused.
    const foreign = await createPillar(B, "Another workspace entirely");
    await patchContent(A2, item.id, { pillarId: foreign });
    expect((await listContent(A2)).find((c) => c.id === item.id)!.pillarId).toBe(sibling);

    // B cannot patch A's piece.
    await patchContent(B, item.id, { hook: "pwned" });
    expect((await listContent(A2)).find((c) => c.id === item.id)!.hook).toBe("Edited on the canvas");
  });

  it("deleting a piece takes its content, and leaves the brand alone", async () => {
    if (!dbReachable) return;
    const ws = { tenantId: A.tenantId, userId: null, isPlatformAdmin: false };
    const D: ProjectScope = { ...ws, projectId: await createProject(ws, "To delete") };
    await generateContent(D, { format: "linkedin_post", topic: "gone soon" });
    const pillarsBefore = (await listPillars(ws)).length;

    // B naming A's project id deletes nothing.
    expect(await deleteProject({ ...B, projectId: D.projectId })).toBe(false);
    expect(await getProject(ws, D.projectId)).not.toBeNull();

    expect(await deleteProject(D)).toBe(true);
    expect(await getProject(ws, D.projectId)).toBeNull();
    expect(await listContent(D)).toEqual([]);
    // The workspace's pillars are the BRAND's, not this piece's: deleting one
    // post must never take the brand down with it (migration 0007).
    expect((await listPillars(ws)).length).toBe(pillarsBefore);
    // Usage history is kept for the workspace.
    expect((await loadUsage(A)).textThisMonth).toBeGreaterThan(0);
  });

  it("parses pillar lines from the pillar_set template output", () => {
    expect(parsePillarLines("1. Contrarian takes :: Where I disagree\n- Proof :: Wins\nnoise")).toEqual([
      { name: "Contrarian takes", description: "Where I disagree" },
      { name: "Proof", description: "Wins" },
    ]);
  });
});
