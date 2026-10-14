/**
 * Layout variants and live tweaks (Visual step). The stored design is parsed
 * defensively, saved per piece, carried across a regenerate, and confined to
 * its tenant (INV-1).
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";
import { createProject, unlockStage, type ProjectScope } from "@/lib/data/projects";
import { generateContent } from "@/lib/data/content";
import { generateVisuals, listVisuals, saveDesign } from "@/lib/data/pipeline";
import { DEFAULT_DESIGN, parseDesign, POST_LAYOUTS, QUOTE_LAYOUTS, CAROUSEL_LAYOUTS, type Design } from "@/lib/visual/design";
import { paint } from "@/app/w/[id]/p/[pid]/visual/visual-layouts";

describe("the design model", () => {
  it("offers 3-4 layouts per artboard kind", () => {
    expect(POST_LAYOUTS.length).toBe(4);
    expect(QUOTE_LAYOUTS.length).toBe(3);
    expect(CAROUSEL_LAYOUTS.length).toBe(3);
  });
  it("reads anything stored without trusting it", () => {
    expect(parseDesign(null)).toEqual(DEFAULT_DESIGN);
    expect(parseDesign({ scheme: 2 })).toEqual(DEFAULT_DESIGN);
    const d = parseDesign({ layouts: { post: "split", quote: "nope" }, tweaks: { scale: 9, align: "center", accent: "loud", background: "tint" } });
    expect(d.layouts).toEqual({ post: "split", quote: "classic", carousel: "standard" });
    expect(d.tweaks).toEqual({ scale: 1.4, align: "center", accent: "subtle", background: "tint" });
  });
  it("tweaks change the paint: inverse flips, no accent hides marks, bold only when readable", () => {
    const s = { name: "S", bg: "#ffffff", fg: "#111111", accent: "#060E9F" };
    expect(paint(s, { ...DEFAULT_DESIGN.tweaks, background: "inverse" }, "normal").bg).toBe("#111111");
    expect(paint(s, DEFAULT_DESIGN.tweaks, "inverse").bg).toBe("#111111");
    expect(paint(s, { ...DEFAULT_DESIGN.tweaks, background: "inverse" }, "inverse").bg).toBe("#ffffff");
    expect(paint(s, { ...DEFAULT_DESIGN.tweaks, accent: "none" }, "normal").showMarks).toBe(false);
    expect(paint(s, { ...DEFAULT_DESIGN.tweaks, accent: "bold" }, "normal").words).toBe("#060E9F");
    const pale = { ...s, accent: "#f0f0ff" };
    expect(paint(pale, { ...DEFAULT_DESIGN.tweaks, accent: "bold" }, "normal").words).toBe("#111111");
  });
});

let dbReachable = false;
let A: ProjectScope;
let B: ProjectScope;

beforeAll(async () => {
  try {
    const probe = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await probe.query("SELECT 1");
    await probe.end();
    dbReachable = true;
  } catch {
    return;
  }
  const mk = (name: string) =>
    withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, async (c) =>
      (await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name])).rows[0].id,
    );
  const [ta, tb] = [await mk("Design A (test)"), await mk("Design B (test)")];
  const wa = { tenantId: ta, userId: null, isPlatformAdmin: false };
  const wb = { tenantId: tb, userId: null, isPlatformAdmin: false };
  A = { ...wa, projectId: await createProject(wa, "A") };
  B = { ...wb, projectId: await createProject(wb, "B") };
});

afterAll(async () => {
  if (!dbReachable) return;
  await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, (c) =>
    c.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[A.tenantId, B.tenantId]]),
  );
  await appPool().end();
});

describe("saving a piece's design", () => {
  it("saves layouts and tweaks, keeps them across a regenerate, and B can't touch A's", async () => {
    if (!dbReachable) return;
    const id = await generateContent(A, { format: "linkedin_post", topic: "design" });
    await unlockStage(A, "content");
    await generateVisuals(A, { scheme: 0, approvedOnly: false });
    expect((await listVisuals(A))[0].design).toEqual(DEFAULT_DESIGN);

    const chosen: Design = { layouts: { post: "editorial", quote: "minimal", carousel: "progress" }, tweaks: { scale: 1.2, align: "center", accent: "bold", background: "tint" } };
    expect(await saveDesign(A, id, chosen)).toBe(true);
    const rows = await listVisuals(A);
    expect(rows.length).toBe(3);
    for (const r of rows) expect(r.design).toEqual(chosen);

    await generateVisuals(A, { scheme: 1, approvedOnly: false });
    const after = await listVisuals(A);
    expect(after.every((r) => r.scheme === 1)).toBe(true);
    expect(after[0].design).toEqual(chosen);

    expect(await saveDesign(B, id, DEFAULT_DESIGN)).toBe(false);
    expect((await listVisuals(A))[0].design).toEqual(chosen);
    expect(await listVisuals(B)).toEqual([]);
  });
});
