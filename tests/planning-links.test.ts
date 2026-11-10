/**
 * Two links the brief asks for and the code had left dangling:
 *   - an idea records the piece it became (`converted_to_content_item_id`, §4.5)
 *   - saved offers reach every prompt as context (§4.4, INV-2)
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";
import { createProject, type ProjectScope } from "@/lib/data/projects";
import { generateContent } from "@/lib/data/content";
import { captureIdea, createOffer, listIdeas } from "@/lib/data/planning";
import { startPiece } from "@/lib/data/create";
import { loadBrandContext } from "@/lib/context/context-loader";
import { buildBrandContext, CONTEXT_VERSION } from "@/lib/context/context-builder";

let dbReachable = false;
let A: ProjectScope;

beforeAll(async () => {
  try {
    const probe = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await probe.query("SELECT 1");
    await probe.end();
    dbReachable = true;
  } catch {
    return;
  }
  const ta = await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, async (c) =>
    (await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ('Links A (test)') RETURNING id")).rows[0].id,
  );
  const wa = { tenantId: ta, userId: null, isPlatformAdmin: false };
  A = { ...wa, projectId: await createProject(wa, "A") };
  await withTenantSession(wa, (c) =>
    c.query(`INSERT INTO brand_profiles (tenant_id, project_id, status, niche) VALUES ($1, NULL, 'active', 'links')`, [ta]),
  );
});

afterAll(async () => {
  if (!dbReachable) return;
  await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, (c) =>
    c.query("DELETE FROM tenants WHERE id = $1", [A.tenantId]),
  );
  await appPool().end();
});

describe("offers in the brand context", () => {
  it("the builder lists saved offers, and the version says so", () => {
    const ctx = buildBrandContext({
      language: "en",
      brandProfile: { niche: "x", offers: [{ name: "Voice Sprint", format: "4-week cohort", promise: "Sound like yourself on LinkedIn" }, { name: "  " }] },
    });
    expect(ctx.version).toBe(CONTEXT_VERSION);
    expect(ctx.serialized).toContain("Voice Sprint: 4-week cohort. Sound like yourself on LinkedIn");
    expect(ctx.serialized).not.toContain("  -  ");
  });

  it("the loader puts the workspace's offers into the block", async () => {
    if (!dbReachable) return;
    await createOffer(A, { name: "Brand Clinic", format: "1:1", promise: "A positioning you can say out loud", deliverables: [], pricingLogic: "" });
    expect((await loadBrandContext(A)).serialized).toContain("Brand Clinic: 1:1. A positioning you can say out loud");
  });
});

describe("an idea records the piece it became", () => {
  it("converted_to_content_item_id is set when the first copy lands", async () => {
    if (!dbReachable) return;
    await captureIdea(A, "Why I stopped offering discounts");
    const idea = (await listIdeas(A))[0];
    expect(idea.convertedTo).toBeNull();

    const projectId = await startPiece(A, { topic: idea.rawText, ideaId: idea.id });
    const contentId = await generateContent({ ...A, projectId }, { format: "linkedin_post", topic: idea.rawText });

    const after = (await listIdeas(A)).find((i) => i.id === idea.id)!;
    expect(after.status).toBe("converted");
    expect(after.convertedTo).toBe(contentId);
    expect(after.projectId).toBe(projectId);

    // A second piece in the same project does not steal the link.
    await generateContent({ ...A, projectId }, { format: "linkedin_post", topic: "again" });
    expect((await listIdeas(A)).find((i) => i.id === idea.id)!.convertedTo).toBe(contentId);
  });
});
