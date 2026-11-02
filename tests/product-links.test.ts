/**
 * The connections the audit found half-made, now joined up:
 * - pasting notes on Home fills only what the workspace brief is missing;
 * - a calendar slot starts a piece carrying its plan, and then points at it;
 * - "New project like this" copies the piece's setup, not a brief;
 * - removing an upload removes it from the reference designs too.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";
import { fillIntake, parseIntake } from "@/lib/intake/parse";
import type { FoundationForm } from "@/lib/data/foundation-types";
import { addCalendarEntry, getCalendarEntry, listCalendar, markSlotStarted } from "@/lib/data/planning";
import { startPiece } from "@/lib/data/create";
import { duplicateProject, getProject } from "@/lib/data/projects";
import { deleteAsset, uploadAsset } from "@/lib/data/assets";

const EMPTY_FOUNDATION: FoundationForm = {
  niche: "", positioning: "", offers: "", audience: "",
  chapters: [{ title: "", body: "" }, { title: "", body: "" }, { title: "", body: "" }],
  tone: "", doWords: "", dontWords: "", readingLevel: "", samplePosts: "", palette: "", fonts: "", imageStyleNotes: "",
};

describe("notes fill the brief, never overwrite it", () => {
  it("fills empty fields and leaves written ones alone", () => {
    const base = { ...EMPTY_FOUNDATION, niche: "Leadership coaching", audience: "" };
    const { form, filled } = fillIntake(base, parseIntake("Niche: Something else entirely\nAudience: First-time managers"));
    expect(form.niche).toBe("Leadership coaching");
    expect(form.audience).toBe("First-time managers");
    expect(filled).toBe(1);
  });
});

let ok = false;
let tenant = "";
let user = "";
const scope = () => ({ tenantId: tenant, userId: user, isPlatformAdmin: false });

beforeAll(async () => {
  try {
    const p = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await p.query("SELECT 1 FROM calendar_entries WHERE started_project_id IS NULL LIMIT 1");
    await p.end();
    ok = true;
  } catch {
    return;
  }
  await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, async (c) => {
    tenant = (await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ('links-test') RETURNING id")).rows[0].id;
    user = (await c.query<{ id: string }>("INSERT INTO users (tenant_id, email, role, status) VALUES ($1, $2, 'client', 'active') RETURNING id", [tenant, `links-${Date.now()}@example.test`])).rows[0].id;
  });
});

afterAll(async () => {
  if (!ok) return;
  await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, (c) => c.query("DELETE FROM tenants WHERE id = $1", [tenant]));
  await appPool().end();
});

describe("a calendar slot and the piece it starts", () => {
  it("carries the plan into the piece and then points at it", async () => {
    if (!ok) return expect(ok).toBe(false);
    await addCalendarEntry(scope(), { date: "2026-12-01", pillarId: null, channel: "linkedin", topic: "Why first managers stop doing", hookAngle: "A confession", cta: "Book a call" });
    const [slot] = await listCalendar(scope(), "2026-12-01", "2026-12-01");
    expect(slot.startedProjectId).toBeNull();

    const projectId = await startPiece(scope(), { topic: slot.topic!, format: "linkedin_post", angle: "A confession. Close with: Book a call" });
    await markSlotStarted(scope(), slot.id, projectId);

    expect((await getCalendarEntry(scope(), slot.id))?.startedProjectId).toBe(projectId);
    const project = await getProject(scope(), projectId);
    expect(project?.angle).toBe("A confession. Close with: Book a call");
    expect(project?.format).toBe("linkedin_post");
  });
});

describe("New project like this", () => {
  it("copies format, platform and angle into a fresh piece", async () => {
    if (!ok) return expect(ok).toBe(false);
    const from = await startPiece(scope(), { topic: "Original", format: "linkedin_post", angle: "A number" });
    const copy = await duplicateProject({ ...scope(), projectId: from }, "Original (again)");
    const p = await getProject(scope(), copy);
    expect(p?.name).toBe("Original (again)");
    expect(p?.format).toBe("linkedin_post");
    expect(p?.angle).toBe("A number");
    expect(p?.stage).toBe("ideate");
  });
});

describe("removing an upload", () => {
  it("deletes the asset and drops it from the reference designs", async () => {
    if (!ok) return expect(ok).toBe(false);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    await uploadAsset(scope(), new File([png], "ref.png", { type: "image/png" }), "reference_image");
    const id = (await withTenantSession(scope(), (c) => c.query<{ id: string }>("SELECT id FROM assets ORDER BY created_at DESC LIMIT 1"))).rows[0].id;
    await withTenantSession(scope(), async (c) => {
      const bp = (await c.query<{ id: string }>("INSERT INTO brand_profiles (tenant_id, project_id, status) VALUES ($1, NULL, 'active') RETURNING id", [tenant])).rows[0].id;
      await c.query("INSERT INTO visual_identities (tenant_id, brand_profile_id, core) VALUES ($1, $2, $3)", [tenant, bp, JSON.stringify({ references: [id, "other"] })]);
    });
    expect(await deleteAsset(scope(), id)).toBe(true);
    const left = await withTenantSession(scope(), async (c) => ({
      assets: (await c.query("SELECT 1 FROM assets WHERE id = $1", [id])).rowCount,
      refs: (await c.query<{ r: string[] }>("SELECT core->'references' AS r FROM visual_identities WHERE tenant_id = $1", [tenant])).rows[0].r,
    }));
    expect(left.assets).toBe(0);
    expect(left.refs).toEqual(["other"]);
    expect(await deleteAsset({ ...scope(), tenantId: "00000000-0000-4000-8000-000000000000" }, id)).toBe(false);
  });
});
