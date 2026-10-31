/**
 * The voice learns from use (lib/voice/learn, lib/data/learning): only the
 * owner's own words teach it, it re-measures itself every few pieces, and one
 * workspace's approvals can never reach another's voice (INV-1).
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";
import { createProject, type ProjectScope } from "@/lib/data/projects";
import { generateContent, listContent, updateContent, regenerateWithSteer } from "@/lib/data/content";
import { learnFromApproval, learningLog } from "@/lib/data/learning";
import { listVersions, loadPackForWorkspace } from "@/lib/data/voice-pack";
import { learnDecision, ownShare, relearnDue, similarity, LEARN_MIN_EDIT, RELEARN_EVERY } from "@/lib/voice/learn";

const OWN = (n: number) =>
  `Piece ${n}. I learned to delegate the hard way, by doing everything myself until the team stopped asking. ` +
  `So now I hand over the outcome, not the task, and I say what good looks like before anyone starts. ` +
  `It is slower on day one and much faster by week three. Try it on one thing this Friday.`;

describe("which approvals teach the voice", () => {
  it("measures how much of a piece is the person's", () => {
    expect(similarity("a b c", "a b c")).toBe(1);
    expect(similarity("a b c", "x y z")).toBe(0);
    expect(ownShare("anything at all", [])).toBe(1);
    expect(ownShare("the same words here", ["the same words here"])).toBe(0);
  });

  it("learns from the owner's own words, never the model's or a coach's", () => {
    const draft = OWN(1);
    expect(learnDecision({ final: draft, generated: [draft], owner: true }).learn).toBe(false);
    expect(learnDecision({ final: OWN(1), generated: [], owner: true })).toMatchObject({ learn: true, why: "Written by you." });
    const rewritten = learnDecision({ final: OWN(2), generated: ["Leverage synergy to unlock delegation at scale with five proven tips for leaders."], owner: true });
    expect(rewritten.learn).toBe(true);
    expect(rewritten.share).toBeGreaterThanOrEqual(LEARN_MIN_EDIT);
    expect(learnDecision({ final: OWN(1), generated: [], owner: false }).learn).toBe(false);
    expect(learnDecision({ final: "Too short.", generated: [], owner: true }).learn).toBe(false);
  });

  it("re-measures every few learned pieces", () => {
    expect(relearnDue(RELEARN_EVERY - 1)).toBe(false);
    expect(relearnDue(RELEARN_EVERY)).toBe(true);
  });
});

let dbReachable = false;
let A: ProjectScope;
let B: ProjectScope;
let ownerA = { userId: "", role: "client" as const };

async function makeWorkspace(name: string, email: string) {
  return withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, async (c) => {
    const t = (await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name])).rows[0].id;
    const u = (await c.query<{ id: string }>("INSERT INTO users (tenant_id, email, role, status) VALUES ($1,$2,'client','active') RETURNING id", [t, email])).rows[0].id;
    return { t, u };
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
  const a = await makeWorkspace("Learning A (test)", "learn-a@test.local");
  const b = await makeWorkspace("Learning B (test)", "learn-b@test.local");
  const wa = { tenantId: a.t, userId: a.u, isPlatformAdmin: false };
  const wb = { tenantId: b.t, userId: b.u, isPlatformAdmin: false };
  A = { ...wa, projectId: await createProject(wa, "A") };
  B = { ...wb, projectId: await createProject(wb, "B") };
  ownerA = { userId: a.u, role: "client" };
});

afterAll(async () => {
  if (!dbReachable) return;
  await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, (c) =>
    c.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[A.tenantId, B.tenantId]]),
  );
  await appPool().end();
});

const approve = async (scope: ProjectScope, id: string, body?: string) => {
  const item = (await listContent(scope)).find((i) => i.id === id)!;
  await updateContent(scope, id, { hook: item.hook ?? "", body: body ?? item.body ?? "", cta: body ? "" : item.cta ?? "", pillarId: null, status: "approved" });
};

describe("learning in the database", () => {
  it("skips a draft approved as written, learns a rewrite, and re-measures", async () => {
    if (!dbReachable) return;
    const pack = (await loadPackForWorkspace(A))!;

    const asIs = await generateContent(A, { format: "linkedin_post", topic: "delegation" });
    await approve(A, asIs);
    expect((await learnFromApproval(A, ownerA, asIs))!.learn).toBe(false);

    for (let n = 1; n <= RELEARN_EVERY; n++) {
      const id = await generateContent(A, { format: "linkedin_post", topic: `delegation ${n}` });
      await approve(A, id, OWN(n));
      const out = (await learnFromApproval(A, ownerA, id))!;
      expect(out.learn).toBe(true);
      expect(out.remeasured).toBe(n === RELEARN_EVERY);
    }
    const log = await learningLog(A, pack.id);
    expect(log.total).toBe(RELEARN_EVERY);
    expect((await listVersions(A, pack.id, 5)).some((v) => /Learned from \d+ pieces/.test(v.note ?? ""))).toBe(true);
  });

  it("keeps what you typed when a regenerate replaces it (brief §07)", async () => {
    if (!dbReachable) return;
    const id = await generateContent(A, { format: "linkedin_post", topic: "handing work over" });
    const before = (await listContent(A)).find((i) => i.id === id)!;
    const mine = "I wrote this line myself and it must survive the next draft.";
    await updateContent(A, id, { hook: mine, body: before.body ?? "", cta: before.cta ?? "", pillarId: null, status: "edited" });

    await regenerateWithSteer(A, id, "Shorter");

    const after = (await listContent(A)).find((i) => i.id === id)!;
    expect(after.hook).not.toBe(mine);                                  // the steer did replace it
    expect(after.history.some((h) => h.hook === mine)).toBe(true);      // and it is recoverable
    const edit = after.history.find((h) => h.hook === mine)!;
    expect(edit.model).toBeNull();                                      // marked as yours, not ours
  });

  it("a coach's approval doesn't teach the client's voice", async () => {
    if (!dbReachable) return;
    const id = await generateContent(A, { format: "linkedin_post", topic: "coach" });
    await approve(A, id, OWN(9));
    const coach = { userId: "00000000-0000-0000-0000-000000000001", role: "coach" as const };
    expect((await learnFromApproval(A, coach, id))!.learn).toBe(false);
  });

  it("never crosses workspaces", async () => {
    if (!dbReachable) return;
    const id = (await listContent(A)).find((i) => i.status === "approved")!.id;
    // B naming A's piece finds nothing to learn from.
    expect(await learnFromApproval(B, { userId: B.userId!, role: "client" }, id)).toBeNull();
    const packB = (await loadPackForWorkspace(B))!;
    expect((await learningLog(B, packB.id)).total).toBe(0);
  });
});
