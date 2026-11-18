/**
 * The 2026-11-18 knowledge and grounding fixes, against the database with the
 * stand-in provider (vitest.config pins it):
 *
 *   C2  a steer that adds an unsupported claim is not saved; the piece keeps its text
 *   H6  the project's angle reaches a draft, whichever caller asks for it
 *   M4  a part rewrite keeps the piece's topic and angle in its task input
 *   H7  private writing is not grounding: it cannot back a fact in a check
 *   M5  a tie on created_at is broken by id, so the sample set does not move
 *
 * The pure halves are in src/lib/voice/rewrite-grounding.test.ts and
 * src/lib/context/context-builder.test.ts.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";
import * as ai from "@/lib/ai";
import { createProject, type ProjectScope } from "@/lib/data/projects";
import {
  createContentItem, generateContent, listContent, regenerateWithSteer, rewritePartOf,
} from "@/lib/data/content";
import { checkText, groundingFor } from "@/lib/data/check";
import { addSamples, fewShotSamplesCounted, getOrCreatePack, listSamples } from "@/lib/data/voice-pack";
import { UnsupportedRewriteError } from "@/lib/voice/judge";
import type { VoiceSample } from "@/lib/voice/types";

// Spy on the facade's calls and let them run: the tests read what the model was asked.
vi.mock("@/lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai")>();
  return { ...actual, generateText: vi.fn(actual.generateText), runTask: vi.fn(actual.runTask) };
});

let db = false;
let A: ProjectScope;
let userA = "";
const ADMIN = { tenantId: null, userId: null, isPlatformAdmin: true };

async function makeTenantWithUser(name: string): Promise<{ tenantId: string; userId: string }> {
  return withTenantSession(ADMIN, async (c) => {
    const tenantId = (await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name])).rows[0].id;
    const userId = (
      await c.query<{ id: string }>(
        "INSERT INTO users (tenant_id, email, role, status) VALUES ($1,$2,'client','active') RETURNING id",
        [tenantId, `${name.replace(/\W+/g, "-").toLowerCase()}@test.local`],
      )
    ).rows[0].id;
    return { tenantId, userId };
  });
}

beforeAll(async () => {
  try {
    const probe = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await probe.query("SELECT 1");
    await probe.end();
    db = true;
  } catch {
    return;
  }
  const t = await makeTenantWithUser("Knowledge grounding test");
  userA = t.userId;
  const wa = { tenantId: t.tenantId, userId: t.userId, isPlatformAdmin: false };
  A = { ...wa, projectId: await createProject(wa, "Grounding project") };
});

afterAll(async () => {
  if (!db) return;
  await withTenantSession(ADMIN, (c) => c.query("DELETE FROM tenants WHERE id = $1", [A.tenantId]));
  await appPool().end();
});

const itemOf = async (id: string) => (await listContent(A)).find((i) => i.id === id)!;

describe("a steer that adds an unsupported claim is not saved (C2)", () => {
  it("is refused with the claim named, and the piece keeps its text and history", async () => {
    if (!db) return;
    // The stand-in's steer (not "shorter") writes "Three things I've learned about ...": a figure the brand context does not state.
    const id = await createContentItem(A, {
      format: "linkedin_post", topic: "Pricing for solo experts", hook: "Pricing is a conversation.",
      body: "Plain body with no claims in it.", cta: "", status: "draft", origin: "own-writing",
    });
    const before = await itemOf(id);
    let caught: unknown = null;
    try {
      await regenerateWithSteer(A, id, "Make it bolder");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnsupportedRewriteError);
    const err = caught as UnsupportedRewriteError;
    expect(err.claims.map((c) => c.kind)).toContain("number");
    expect(err.message).toMatch(/^Nothing was changed\. The rewrite adds “/);

    const after = await itemOf(id);
    expect(after.hook).toBe(before.hook);
    expect(after.body).toBe(before.body);
    expect(after.history.length).toBe(before.history.length);
  });

  it("a steer that adds no claim is saved as before", async () => {
    if (!db) return;
    const id = await createContentItem(A, {
      format: "linkedin_post", topic: "Pricing for solo experts", hook: "Pricing is a conversation.",
      body: "Plain body with no claims in it.", cta: "", status: "draft", origin: "own-writing",
    });
    const before = await itemOf(id);
    await regenerateWithSteer(A, id, "Shorter");
    const after = await itemOf(id);
    expect(after.history.length).toBe(before.history.length + 1);
    expect(after.history.at(-1)!.steer).toBe("Shorter");
  });
});

describe("the project's angle reaches a draft, whichever caller asks (H6)", () => {
  it("a draft with no angle in its input is written to the piece's angle", async () => {
    if (!db) return;
    await withTenantSession(A, (c) => c.query("UPDATE projects SET angle = $1 WHERE id = $2", ["a story from the work", A.projectId]));
    vi.mocked(ai.generateText).mockClear();
    await generateContent(A, { format: "linkedin_post", topic: "Hiring a first person" });
    const call = vi.mocked(ai.generateText).mock.calls.at(-1)!;
    const req = call[1] as { taskInput: string };
    expect(req.taskInput).toContain("Angle: a story from the work");
    expect(req.taskInput).toContain("Topic: Hiring a first person");
  });
});

describe("a part rewrite keeps the piece's topic and angle (M4)", () => {
  it("the rewrite's task input names the topic and the angle the piece was set up with", async () => {
    if (!db) return;
    const id = await createContentItem(A, {
      format: "linkedin_post", topic: "Pricing for solo experts", hook: "Pricing is a conversation.",
      body: "Plain body with no claims in it.", cta: "", status: "draft", origin: "own-writing",
    });
    vi.mocked(ai.runTask).mockClear();
    const out = await rewritePartOf(A, id, { part: "hook", text: "Pricing is a conversation.", instruction: "make it punchier" });
    expect(out).toBeTruthy();
    const call = vi.mocked(ai.runTask).mock.calls.find((c) => (c[1] as { key: string }).key === "rewrite_part");
    const input = (call![2] as { taskInput: string }).taskInput;
    expect(input).toContain("Topic: Pricing for solo experts");
    expect(input).toContain("Angle: a story from the work");
  });
});

describe("private writing is not grounding for a check (H7)", () => {
  it("a fact that appears only in private writing does not back a draft's claim", async () => {
    if (!db) return;
    const pack = await getOrCreatePack(A, userA);
    await addSamples(A, pack.id, [{ body: "I landed 12 clients last year, and I never told anyone.", visibility: "private" }]);
    const r = await checkText(A, "I landed 12 clients last year.", null, { copyCheck: false });
    expect(r.issues.some((i) => i.code === "unsupported_claim")).toBe(true);
  });

  it("a fact in public writing does back it", async () => {
    if (!db) return;
    const pack = await getOrCreatePack(A, userA);
    await addSamples(A, pack.id, [{ body: "I landed 40 clients in one year, the slow honest way.", visibility: "public" }]);
    const r = await checkText(A, "I landed 40 clients in one year.", null, { copyCheck: false });
    expect(r.issues.some((i) => i.code === "unsupported_claim")).toBe(false);
  });

  it("grounding is the public samples and the topic, never the private ones", async () => {
    const sample = (body: string, visibility: "public" | "private") => ({ body, visibility }) as unknown as VoiceSample;
    const g = await groundingFor(A, "Topic words", [
      sample("Public line about the work.", "public"),
      sample("Private line about a client deal.", "private"),
    ]);
    expect(g).toContain("Public line about the work.");
    expect(g).toContain("Topic words");
    expect(g).not.toContain("Private line about a client deal.");
  });
});

describe("the sample set does not move on a tie (M5)", () => {
  it("samples saved at the same instant come back in id order, and the count is every eligible piece", async () => {
    if (!db) return;
    const pack = await getOrCreatePack(A, userA);
    await addSamples(A, pack.id, [
      { body: "Tie one body text for ordering.", visibility: "public" },
      { body: "Tie two body text for ordering.", visibility: "public" },
      { body: "Tie three body text for ordering.", visibility: "public" },
    ]);
    await withTenantSession(A, (c) =>
      c.query("UPDATE voice_samples SET created_at = '2026-01-01T00:00:00Z' WHERE pack_id = $1 AND body LIKE 'Tie %'", [pack.id]),
    );
    const all = await listSamples(A, pack.id);
    const ties = all.filter((s) => s.body.startsWith("Tie ")).map((s) => s.id);
    expect(ties.length).toBe(3);
    expect(ties).toEqual([...ties].sort());

    const { total } = await fewShotSamplesCounted(A, pack.id);
    expect(total).toBe(all.filter((s) => s.visibility === "public").length);
  });
});
