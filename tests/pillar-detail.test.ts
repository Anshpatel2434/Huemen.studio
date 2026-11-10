/** A pillar's connected map reads only its own workspace's ideas, slots and pieces (INV-1). */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";
import { addCalendarEntry, captureIdea, createPillar, listPillars, pillarDetail } from "@/lib/data/planning";

let db = false;
const A = { tenantId: "", userId: null, isPlatformAdmin: false };
const B = { tenantId: "", userId: null, isPlatformAdmin: false };

beforeAll(async () => {
  try { const p = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 }); await p.query("SELECT 1"); await p.end(); db = true; } catch { return; }
  await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, async (c) => {
    A.tenantId = (await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ('Pillar map A') RETURNING id")).rows[0].id;
    B.tenantId = (await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ('Pillar map B') RETURNING id")).rows[0].id;
  });
});
afterAll(async () => {
  if (!db) return;
  await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, (c) => c.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[A.tenantId, B.tenantId]]));
  await appPool().end();
});

describe("pillar detail", () => {
  it("shows what grows from the pillar, and nothing to another workspace", async () => {
    if (!db) return;
    await createPillar(A, "Systems");
    const pillar = (await listPillars(A))[0];
    await captureIdea(A, "Systems beat heroics");
    await addCalendarEntry(A, { date: "2026-11-02", pillarId: pillar.id, channel: "linkedin", topic: "A simple framework for systems", hookAngle: "", cta: "" });
    const d = (await pillarDetail(A, pillar.id))!;
    expect(d.pillar.name).toBe("Systems");
    expect(d.slots.map((s) => s.topic)).toEqual(["A simple framework for systems"]);
    expect(d.ideas.length).toBeGreaterThanOrEqual(1);
    expect(await pillarDetail(B, pillar.id)).toBeNull();
  });
});
