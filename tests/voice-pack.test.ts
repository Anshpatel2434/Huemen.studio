/**
 * Voice Pack data paths (client spec v2).
 *
 * Three things are tested because getting any of them wrong is expensive:
 *   1. Tenant isolation, as everywhere else (INV-1).
 *   2. A voice belongs to a PERSON — one human's two brands share one pack.
 *   3. Private writing (sent email, chat) is measured but NEVER handed to a
 *      prompt, so its facts cannot reach a draft.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";
import { createProject, type ProjectScope } from "@/lib/data/projects";
import { loadFoundation, saveFoundation } from "@/lib/data/foundation";
import { loadBrandContext } from "@/lib/context/context-loader";
import {
  addSamples, fewShotSamples, getOrCreatePack, listSamples, listVersions,
  loadPackForWorkspace, rescan, savePack,
} from "@/lib/data/voice-pack";
import { tagged } from "@/lib/voice/types";

let dbReachable = false;
let A: ProjectScope;   // tenant A, project 1
let A2: ProjectScope;  // tenant A, project 2 — same person, second brand
let B: ProjectScope;   // tenant B
let userA = "";
let userB = "";

async function makeTenantWithUser(name: string): Promise<{ tenantId: string; userId: string }> {
  return withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, async (c) => {
    const tenantId = (
      await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name])
    ).rows[0].id;
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
    dbReachable = true;
  } catch {
    return;
  }
  const a = await makeTenantWithUser("Voice A test");
  const b = await makeTenantWithUser("Voice B test");
  userA = a.userId;
  userB = b.userId;
  const wa = { tenantId: a.tenantId, userId: a.userId, isPlatformAdmin: false };
  const wb = { tenantId: b.tenantId, userId: b.userId, isPlatformAdmin: false };
  A = { ...wa, projectId: await createProject(wa, "A brand one") };
  A2 = { ...wa, projectId: await createProject(wa, "A brand two") };
  B = { ...wb, projectId: await createProject(wb, "B brand") };
});

afterAll(async () => {
  if (!dbReachable) return;
  await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, (c) =>
    c.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[A.tenantId, B.tenantId]]),
  );
  await appPool().end();
});

describe("a voice belongs to a person", () => {
  it("gives the same person one pack across both their brands", async () => {
    if (!dbReachable) return;
    const one = await loadPackForWorkspace(A);
    const two = await loadPackForWorkspace(A2);
    expect(one).not.toBeNull();
    expect(two!.id).toBe(one!.id);
    expect(one!.userId).toBe(userA);
  });

  it("gives a different person a different pack", async () => {
    if (!dbReachable) return;
    const a = await loadPackForWorkspace(A);
    const b = await loadPackForWorkspace(B);
    expect(b!.id).not.toBe(a!.id);
    expect(b!.userId).toBe(userB);
  });

  it("starts provisional, because nothing has been measured yet", async () => {
    if (!dbReachable) return;
    const pack = await getOrCreatePack(B, userB);
    expect(pack.status).toBe("provisional");
    expect(pack.corpusStats.pieces).toBe(0);
  });
});

describe("tenant isolation", () => {
  it("hides one workspace's pack, corpus and versions from another", async () => {
    if (!dbReachable) return;
    const a = (await loadPackForWorkspace(A))!;
    await addSamples(A, a.id, [{ body: "A private thought about a client deal." }]);

    // B knows the id and still gets nothing: RLS keys on tenant, not on the id.
    expect(await listSamples(B, a.id)).toEqual([]);
    expect(await fewShotSamples(B, a.id)).toEqual([]);
    expect(await listVersions(B, a.id)).toEqual([]);
    expect(await savePack(B, a.id, { voiceLine: "pwned" }, "cross-tenant")).toBeNull();

    const still = (await loadPackForWorkspace(A))!;
    expect(still.voiceLine).not.toBe("pwned");
  });
});

describe("private sources teach rhythm, never facts", () => {
  it("measures a private piece but never offers it to a prompt", async () => {
    if (!dbReachable) return;
    const pack = (await loadPackForWorkspace(A))!;
    await addSamples(A, pack.id, [
      { body: "Hi Sam, the Q3 number is 41 lakh and the deal closes Friday.", channel: "email", visibility: "private" },
      { body: "Most brand problems are clarity problems. Nothing else.", channel: "linkedin", visibility: "public" },
    ]);

    const forPrompt = await fewShotSamples(A, pack.id, "email");
    expect(forPrompt.every((s) => s.visibility === "public")).toBe(true);
    expect(forPrompt.map((s) => s.body).join(" ")).not.toContain("41 lakh");

    // ...but it still counts towards what we know about how they write.
    const scan = await rescan(A, pack.id);
    expect(scan.stats.pieces).toBeGreaterThanOrEqual(2);
    expect(scan.stats.channels).toContain("email");
  });

  it("caps how much real writing goes into one prompt", async () => {
    if (!dbReachable) return;
    const pack = (await loadPackForWorkspace(A))!;
    await addSamples(
      A, pack.id,
      Array.from({ length: 14 }, (_, i) => ({ body: `Piece number ${i} about clarity and attention.`, channel: "linkedin" })),
    );
    const few = await fewShotSamples(A, pack.id, "linkedin");
    expect(few.length).toBeLessThanOrEqual(8);
  });
});

describe("the scan", () => {
  it("tags a channel measured only once it has earned it", async () => {
    if (!dbReachable) return;
    const pack = (await loadPackForWorkspace(B))!;
    await addSamples(B, pack.id, [
      ...Array.from({ length: 6 }, (_, i) => ({ body: `A LinkedIn post about the ${i}th thing I got wrong.`, channel: "linkedin" })),
      { body: "One lonely tweet.", channel: "x" },
    ]);
    const scan = await rescan(B, pack.id);
    expect(scan.measuredChannels).toContain("linkedin");
    expect(scan.inferredChannels).toContain("x");

    const after = (await loadPackForWorkspace(B))!;
    expect(after.contexts.linkedin.tag).toBe("measured");
    expect(after.contexts.x.tag).toBe("inferred");
    expect(after.status).toBe("active");
    expect(after.mechanics.sentences?.confidence).toBe("measured");
  });

  it("leaves what the user typed alone", async () => {
    if (!dbReachable) return;
    const pack = (await loadPackForWorkspace(B))!;
    await savePack(B, pack.id, {
      index: { ...pack.index, neverWords: ["synergy"], allowedExceptions: ["let's dive in"] },
    }, "user set a never-list");

    await rescan(B, pack.id);
    const after = (await loadPackForWorkspace(B))!;
    expect(after.index.neverWords).toEqual(["synergy"]);
    expect(after.index.allowedExceptions).toEqual(["let's dive in"]);
  });
});

describe("versions", () => {
  it("keeps what each save replaced", async () => {
    if (!dbReachable) return;
    const pack = (await loadPackForWorkspace(A))!;
    await savePack(A, pack.id, { voiceLine: "First line." }, "first");
    await savePack(A, pack.id, { voiceLine: "Second line." }, "second");

    const versions = await listVersions(A, pack.id);
    expect(versions.length).toBeGreaterThanOrEqual(2);
    expect(versions[0].version).toBeGreaterThan(versions[1].version);
    expect(versions.some((v) => v.snapshot.voiceLine === "First line.")).toBe(true);

    const now = (await loadPackForWorkspace(A))!;
    expect(now.voiceLine).toBe("Second line.");
  });
});

describe("the brief's voice fields are a view of the pack", () => {
  it("saves the voice to the pack and reads it back from there", async () => {
    if (!dbReachable) return;
    const form = await loadFoundation(A);
    await saveFoundation(A, {
      ...form,
      niche: "Leadership coaching",
      tone: "direct, warm",
      dontWords: "synergy, hustle",
      readingLevel: "plain",
      samplePosts: form.samplePosts,
    });

    const pack = (await loadPackForWorkspace(A))!;
    expect(pack.identity.toneDescriptors?.value).toEqual(["direct", "warm"]);
    expect(pack.index.neverWords).toEqual(["synergy", "hustle"]);

    const back = await loadFoundation(A);
    expect(back.tone).toBe("direct, warm");
    expect(back.dontWords).toBe("synergy, hustle");
  });

  it("shows the same voice in the person's OTHER brand", async () => {
    if (!dbReachable) return;
    const other = await loadFoundation(A2);
    expect(other.tone).toBe("direct, warm");
    expect(other.dontWords).toBe("synergy, hustle");
  });

  it("does not shred a multi-paragraph post into fragments on re-save", async () => {
    if (!dbReachable) return;
    const pack = (await loadPackForWorkspace(A))!;
    const multi = "The first line lands.\n\nThen the turn.\n\nAnd the question?";
    await addSamples(A, pack.id, [{ body: multi, channel: "linkedin" }]);

    const before = (await listSamples(A, pack.id)).length;
    const form = await loadFoundation(A);
    await saveFoundation(A, form);
    const after = await listSamples(A, pack.id);

    expect(after.length).toBe(before);
    expect(after.some((s) => s.body === multi)).toBe(true);
  });
});

describe("the one context builder", () => {
  it("puts the person's voice, guardrails and real writing into the prompt block", async () => {
    if (!dbReachable) return;
    const pack = (await loadPackForWorkspace(A))!;
    await savePack(A, pack.id, {
      voiceLine: "Finds the big idea in a small moment.",
      hardRules: ["Never claim a title. Let the reader conclude it."],
      guardrails: [{
        id: "g1", name: "Self-labelling", source: "ask",
        rule: "Never call herself a thought leader.",
        why: "If people think it, fine. She won't say it.",
        instead: "Show the work and let them decide.",
      }],
      identity: { ...pack.identity, carries: tagged("Most brand problems are clarity problems.", "ask") },
    }, "voice set");

    const ctx = await loadBrandContext(A, "en", "linkedin");
    expect(ctx.version).toBe(2);
    expect(ctx.serialized).toContain("Finds the big idea in a small moment.");
    expect(ctx.serialized).toContain("Never call herself a thought leader.");
    expect(ctx.serialized).toContain("Why: If people think it");
    expect(ctx.serialized).toContain("clarity problems");
    expect(ctx.guardrails.dontWords).toEqual(["synergy", "hustle"]);
  });

  it("never puts a private piece into the prompt block", async () => {
    if (!dbReachable) return;
    const ctx = await loadBrandContext(A, "en", "email");
    expect(ctx.serialized).not.toContain("41 lakh");
  });
});
