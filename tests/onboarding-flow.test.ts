/**
 * The onboarding flow from zero to the dashboard: who is sent through it,
 * where it resumes, and the "About you" step against a real database.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";
import type { WorkspaceScope } from "@/lib/data/projects";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { loadFoundation } from "@/lib/data/foundation";
import { completeOnboarding, resumeStep, saveAbout, updateOnboarding } from "@/lib/data/onboarding";
import { firstPieceStale, FIRST_PIECE_STALE_MS, ingestStalled, INGEST_HEARTBEAT_MS } from "@/lib/voice/lifecycle";
import { proposeTopics, topicsStale } from "@/lib/data/create";
import { createPillar } from "@/lib/data/planning";
import { emptyIndex, type VoicePack } from "@/lib/voice/types";
import { isOwnSetup, mustOnboard } from "@/app/w/[id]/onboarding/gate";

function pack(over: Partial<VoicePack> = {}): VoicePack {
  return {
    id: "p1", userId: "u1", slug: "default", displayName: "", status: "provisional", version: 1,
    voiceLine: "", hardRules: [], identity: {}, guardrails: [], mechanics: {}, contexts: {}, redPen: {},
    index: emptyIndex(), corpusStats: { pieces: 0, words: 0, sentences: 0, channels: [] }, scannedAt: null,
    onboarding: {}, workMode: "ghostwrite", topicSuggestions: [], topicsGeneratedAt: null,
    ...over,
  };
}
const NOW = Date.parse("2026-10-02T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("where onboarding resumes", () => {
  it("opens on About you until it's saved, whatever else was done", () => {
    expect(resumeStep({})).toBe(0);
    expect(resumeStep({ step: 3 })).toBe(0);
  });

  it("then opens at the furthest step reached, within 1–4", () => {
    const w = new Date().toISOString();
    expect(resumeStep({ welcomedAt: w })).toBe(1);
    expect(resumeStep({ welcomedAt: w, step: 3 })).toBe(3);
    expect(resumeStep({ welcomedAt: w, step: 9 })).toBe(4);
  });

  it("never sends someone who finished before About you existed back to it", () => {
    expect(resumeStep({ completedAt: new Date().toISOString(), step: 4 })).toBe(4);
  });
});

describe("who is sent through onboarding", () => {
  const client = { userId: "u1", role: "client" as const };

  it("sends a client whose own voice isn't set up", () => {
    expect(mustOnboard(client, pack(), "t1", undefined)).toBe(true);
  });

  it("lets them in once they've finished", () => {
    expect(mustOnboard(client, pack({ onboarding: { completedAt: new Date().toISOString() } }), "t1", undefined)).toBe(false);
  });

  it("never sends a coach or an admin: it isn't their voice", () => {
    expect(mustOnboard({ userId: "u1", role: "coach" }, pack(), "t1", undefined)).toBe(false);
    expect(mustOnboard({ userId: "u1", role: "owner_admin" }, pack(), "t1", undefined)).toBe(false);
    expect(isOwnSetup({ userId: "someone-else", role: "client" }, pack())).toBe(false);
    expect(isOwnSetup(client, null)).toBe(false);
  });

  it("honours Finish later for that workspace only", () => {
    expect(mustOnboard(client, pack(), "t1", "t1")).toBe(false);
    expect(mustOnboard(client, pack(), "t1", "t2")).toBe(true);
  });
});

describe("an upload cut off by a reload", () => {
  it("is stalled once no file has landed for the heartbeat", () => {
    expect(ingestStalled({ state: "ingesting", at: ago(INGEST_HEARTBEAT_MS + 1) }, NOW)).toBe(true);
  });

  it("is not stalled while files are still landing, or once measured", () => {
    expect(ingestStalled({ state: "ingesting", at: ago(2_000) }, NOW)).toBe(false);
    expect(ingestStalled({ state: "learning", at: ago(INGEST_HEARTBEAT_MS * 3) }, NOW)).toBe(false);
    expect(ingestStalled({ state: "done", at: ago(INGEST_HEARTBEAT_MS * 3) }, NOW)).toBe(false);
    expect(ingestStalled(undefined, NOW)).toBe(false);
  });
});

describe("the first piece, written once", () => {
  it("counts a write as alive until it has run well past the model timeout", () => {
    expect(firstPieceStale({ state: "writing", at: ago(30_000) }, NOW)).toBe(false);
    expect(firstPieceStale({ state: "writing", at: ago(FIRST_PIECE_STALE_MS + 1) }, NOW)).toBe(true);
    expect(firstPieceStale(undefined, NOW)).toBe(false);
  });
});

describe("topic proposals and the pillars they came from", () => {
  it("are stale once a pillar is added after them", () => {
    expect(topicsStale(ago(60_000), ago(1_000))).toBe(true);
  });

  it("stay fresh when nothing changed, or there are no pillars", () => {
    expect(topicsStale(ago(1_000), ago(60_000))).toBe(false);
    expect(topicsStale(ago(1_000), null)).toBe(false);
    expect(topicsStale(null, ago(1_000))).toBe(false);
  });
});

// ---- against the database --------------------------------------------------------

let dbReachable = false;
let W: WorkspaceScope;
let userId: string;

beforeAll(async () => {
  try {
    const probe = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await probe.query("SELECT 1");
    await probe.end();
    dbReachable = true;
  } catch {
    return;
  }
  const ids = await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, async (c) => {
    const tenantId = (await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ('Onboarding flow test') RETURNING id")).rows[0].id;
    const user = (await c.query<{ id: string }>(
      "INSERT INTO users (tenant_id, email, role, status) VALUES ($1,'flow@test.local','client','active') RETURNING id",
      [tenantId],
    )).rows[0].id;
    return { tenantId, user };
  });
  W = { tenantId: ids.tenantId, userId: ids.user, isPlatformAdmin: false };
  userId = ids.user;
});

afterAll(async () => {
  if (!dbReachable) return;
  await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, (c) =>
    c.query("DELETE FROM tenants WHERE id = $1", [W.tenantId]),
  );
  await appPool().end();
});

describe("About you, from zero", () => {
  const owner = () => ({ userId, role: "client" as const });

  it("starts a brand-new person at step 0 with no brief", async () => {
    if (!dbReachable) return;
    const p = (await loadPackForWorkspace(W))!;
    expect(resumeStep(p.onboarding)).toBe(0);
    expect((await loadFoundation(W)).niche).toBe("");
  });

  it("saves their name and the brief's basics, then resumes at step 1", async () => {
    if (!dbReachable) return;
    await saveAbout(W, owner(), (await loadPackForWorkspace(W))!, {
      name: "Priya Shah", niche: "Pricing for B2B SaaS", audience: "Seed to Series B founders", offers: "Pricing audits", positioning: "",
    });
    const p = (await loadPackForWorkspace(W))!;
    const f = await loadFoundation(W);
    expect(p.displayName).toBe("Priya Shah");
    expect(p.onboarding.welcomedAt).toBeTruthy();
    expect(resumeStep(p.onboarding)).toBe(1);
    expect(f.niche).toBe("Pricing for B2B SaaS");
    expect(f.audience).toBe("Seed to Series B founders");
    expect(f.offers).toBe("Pricing audits");
  });

  it("keeps what the brief had when a field comes back blank", async () => {
    if (!dbReachable) return;
    await saveAbout(W, owner(), (await loadPackForWorkspace(W))!, { name: "", niche: "", audience: "", offers: "", positioning: "Prices that hold" });
    const f = await loadFoundation(W);
    expect(f.niche).toBe("Pricing for B2B SaaS");
    expect(f.positioning).toBe("Prices that hold");
    expect((await loadPackForWorkspace(W))!.displayName).toBe("Priya Shah");
  });

  it("goes back to About you without losing the step reached", async () => {
    if (!dbReachable) return;
    const p = (await loadPackForWorkspace(W))!;
    await updateOnboarding(W, p, { step: 3 });
    const welcomedBefore = (await loadPackForWorkspace(W))!.onboarding.welcomedAt;
    await saveAbout(W, owner(), (await loadPackForWorkspace(W))!, { name: "Priya Shah", niche: "Pricing", audience: "", offers: "", positioning: "" });
    const after = (await loadPackForWorkspace(W))!;
    expect(resumeStep(after.onboarding)).toBe(3);
    expect(after.onboarding.welcomedAt).toBe(welcomedBefore);
  });

  it("re-proposes topics made before the pillars existed (found in the browser)", async () => {
    if (!dbReachable) return;
    const before = await proposeTopics(W);
    expect(before.every((t) => !/photography/i.test(t.pillar))).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    await createPillar(W, "Photography for founders", "");
    const after = await proposeTopics(W);
    expect(after.some((t) => /photography for founders/i.test(t.pillar))).toBe(true);
    // And the new proposals are cached again: a second look costs nothing.
    expect(await proposeTopics(W)).toEqual(after);
  });

  it("is let into the studio once finished", async () => {
    if (!dbReachable) return;
    await completeOnboarding(W, (await loadPackForWorkspace(W))!);
    const p = (await loadPackForWorkspace(W))!;
    expect(mustOnboard(owner(), p, W.tenantId!, undefined)).toBe(false);
  });
});
