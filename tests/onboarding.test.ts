/**
 * Onboarding, Create, Check and Train against a real database (build steps
 * 4–8). The AI layer runs on the stand-in, so every flow is exercised end to
 * end with no key; what's tested is that each write lands where it should and
 * that the rules around writes hold.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";
import { getProject, setIdeate, type ProjectScope, type WorkspaceScope } from "@/lib/data/projects";
import { addSamples, listSamples, listVersions, loadPackForWorkspace, previewRescan, savePack } from "@/lib/data/voice-pack";
import {
  answer, dropOpener, finishIngest, ingestPieces, resolveCard, saveDials, setBenchmarks, setGuardrailRule, setNeverWords,
  setWorkMode, setWriteFor,
} from "@/lib/data/onboarding";
import { listProjects } from "@/lib/data/projects";
import { loadVisualIdentity, saveVisualIdentity } from "@/lib/data/foundation";
import { scoreContentItem } from "@/lib/data/check";
import {
  approvedPieceCount, approvedSince, decideEditProposal, decideProposal, listEditProposals, listProposals, recordEdit,
  restoreVersion, writePack, type Actor,
} from "@/lib/data/training";
import { coWrite, ownDraft, proposeTopics, startPiece } from "@/lib/data/create";
import { checkText, judgeText, rewriteText } from "@/lib/data/check";
import { createPillar } from "@/lib/data/planning";
import { listContent } from "@/lib/data/content";
import { confirmCards } from "@/lib/voice/derive";
import { ingestLinkedIn } from "@/lib/voice/ingest";

let dbReachable = false;
let W: WorkspaceScope;
let other: WorkspaceScope;
let owner: Actor;
let coach: Actor;

async function setup(name: string) {
  return withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, async (c) => {
    const tenantId = (await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name])).rows[0].id;
    const user = (await c.query<{ id: string }>(
      "INSERT INTO users (tenant_id, email, role, status) VALUES ($1,$2,'client','active') RETURNING id",
      [tenantId, `${name.toLowerCase().replace(/\W+/g, "-")}@test.local`],
    )).rows[0].id;
    const coachId = (await c.query<{ id: string }>(
      "INSERT INTO users (tenant_id, email, role, status) VALUES ($1,$2,'coach','active') RETURNING id",
      [tenantId, `coach-${name.toLowerCase().replace(/\W+/g, "-")}@test.local`],
    )).rows[0].id;
    return { tenantId, user, coachId };
  });
}

const POSTS = Array.from({ length: 12 }, (_, i) =>
  `Day ${i + 1} of managing a team.\n\nI used to fix every problem myself. Now I ask one question first.\n\nWhat would you do?`,
);

beforeAll(async () => {
  try {
    const probe = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await probe.query("SELECT 1");
    await probe.end();
    dbReachable = true;
  } catch {
    return;
  }
  const a = await setup("Onboarding A test");
  const b = await setup("Onboarding B test");
  W = { tenantId: a.tenantId, userId: a.user, isPlatformAdmin: false };
  other = { tenantId: b.tenantId, userId: b.user, isPlatformAdmin: false };
  owner = { userId: a.user, role: "client" };
  coach = { userId: a.coachId, role: "coach" };
});

afterAll(async () => {
  if (!dbReachable) return;
  await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, (c) =>
    c.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[W.tenantId, other.tenantId]]),
  );
  await appPool().end();
});

const pack = async (s: WorkspaceScope = W) => (await loadPackForWorkspace(s))!;

describe("step 1: add samples", () => {
  it("ingests an export, measures it, and moves the stepper to step 2", async () => {
    if (!dbReachable) return;
    const csv = "Date,ShareLink,ShareCommentary\n" + POSTS.map((p, i) => `2026-0${(i % 9) + 1}-01,https://x/${i},"${p}"`).join("\n");
    const p = await pack();
    const added = await ingestPieces(W, p, ingestLinkedIn(csv).pieces, "export");
    expect(added).toBe(12);
    const scan = await finishIngest(W, p);
    expect(scan.stats.pieces).toBe(12);
    expect((await pack()).onboarding.step).toBe(2);
  });

  it("creates an inferred block for every platform we write for", async () => {
    if (!dbReachable) return;
    await setWriteFor(W, owner, await pack(), ["linkedin", "email"]);
    const p = await pack();
    expect(p.onboarding.writeFor).toEqual(["linkedin", "email"]);
    expect(p.contexts.email.tag).toBe("inferred");
    expect(p.contexts.linkedin.tag).toBe("measured");
  });
});

describe("step 2: confirm your voice", () => {
  it("saves Core answers where the spec says they go, and records them as answered", async () => {
    if (!dbReachable) return;
    await answer(W, owner, await pack(), "A2", "A new manager reading me on the train home");
    await answer(W, owner, await pack(), "E1", ["synergy", "leverage"]);
    await answer(W, owner, await pack(), "D1", "I'd never call myself a thought leader");
    const p = await pack();
    expect(p.identity.reader?.value).toBe("A new manager reading me on the train home");
    expect(p.index.neverWords).toEqual(["synergy", "leverage"]);
    expect(p.guardrails.find((g) => g.id === "self-label")?.rule).toContain("thought leader");
    expect(p.onboarding.answered).toEqual(expect.arrayContaining(["A2", "E1", "D1"]));
  });

  it("keeps a spoken answer as a spoken sample", async () => {
    if (!dbReachable) return;
    const long = "I'd be the person in the corner asking everyone what actually went wrong on their last project, and then admitting my own worst one before they had to.";
    await answer(W, owner, await pack(), "C1", long);
    expect((await listSamples(W, (await pack()).id)).some((s) => s.kind === "spoken" && s.body === long)).toBe(true);
  });

  it("raises an H1 card when a dial is moved far from the writing, and resolves it", async () => {
    if (!dbReachable) return;
    await saveDials(W, owner, await pack(), { casual_formal: 10, fun_serious: 5 });
    let p = await pack();
    const samples = await listSamples(W, p.id);
    const h1 = confirmCards(p, samples).find((c) => c.kind === "H1");
    if (h1) {
      await resolveCard(W, owner, p, h1.id, "want");
      p = await pack();
      expect(confirmCards(p, samples).find((c) => c.id === h1.id)).toBeUndefined();
      expect(p.identity.dials?.confidence).toBe("aspiration");
    }
    expect(p.index.dials.casual_formal).toBe(10);
  });

  it("makes exactly the three picked pieces benchmarks", async () => {
    if (!dbReachable) return;
    const p = await pack();
    const ids = (await listSamples(W, p.id)).filter((s) => s.visibility === "public").slice(0, 4).map((s) => s.id);
    await setBenchmarks(W, p, ids);
    const marked = (await listSamples(W, p.id)).filter((s) => s.kind === "benchmark");
    expect(marked).toHaveLength(3);
  });

  it("stores the way of working", async () => {
    if (!dbReachable) return;
    await setWorkMode(W, owner, await pack(), "cowrite");
    expect((await pack()).workMode).toBe("cowrite");
  });
});

describe("a coach proposes, the owner decides", () => {
  it("turns a coach's change into a proposal instead of a save", async () => {
    if (!dbReachable) return;
    const p = await pack();
    const out = await writePack(W, coach, p, { voiceLine: "Coach's version of the line." }, "Coach suggestion");
    expect(out).toEqual({ proposed: true });
    expect((await pack()).voiceLine).not.toBe("Coach's version of the line.");
    const [proposal] = await listProposals(W, p.id);
    expect(proposal.proposedBy).toContain("coach-");
    expect(proposal.fields).toEqual(["voiceLine"]);
  });

  it("lets only the owner approve, and applies the change when they do", async () => {
    if (!dbReachable) return;
    const p = await pack();
    const [proposal] = await listProposals(W, p.id);
    expect(await decideProposal(W, coach, p, proposal.id, true)).toBe(false);
    expect(await decideProposal(W, owner, p, proposal.id, true)).toBe(true);
    expect((await pack()).voiceLine).toBe("Coach's version of the line.");
    expect(await listProposals(W, p.id)).toEqual([]);
  });

  it("hides a workspace's proposals from another workspace", async () => {
    if (!dbReachable) return;
    expect(await listProposals(other, (await pack()).id)).toEqual([]);
  });
});

describe("edits are training", () => {
  it("proposes a never-word after the fourth time it's removed, never before", async () => {
    if (!dbReachable) return;
    const p = await pack();
    for (let i = 0; i < 3; i++) await recordEdit(W, p, "We should unpack this today", "We should look at this today");
    expect(await listEditProposals(W, p.id)).toEqual([]);
    await recordEdit(W, p, "Let me unpack it", "Let me explain it");
    const [proposal] = await listEditProposals(W, p.id);
    expect(proposal).toMatchObject({ value: "unpack", count: 4 });

    await decideEditProposal(W, owner, await pack(), proposal.id, true);
    expect((await pack()).index.neverWords).toContain("unpack");
    expect(await listEditProposals(W, p.id)).toEqual([]);
  });
});

describe("versions", () => {
  it("restores an earlier version, and the restore is itself a version", async () => {
    if (!dbReachable) return;
    let p = await pack();
    await savePack(W, p.id, { voiceLine: "Before." }, "before");
    p = await pack();
    const v = p.version;
    await savePack(W, p.id, { voiceLine: "After." }, "after");
    await restoreVersion(W, owner, await pack(), v);
    p = await pack();
    expect(p.voiceLine).toBe("Before.");
    expect((await listVersions(W, p.id, 3))[0].note).toBeTruthy();
  });
});

describe("create", () => {
  it("proposes three topics from the pillars, caches them, and refreshes only on request", async () => {
    if (!dbReachable) return;
    await createPillar(W, "Delegation");
    await createPillar(W, "Hiring");
    const first = await proposeTopics(W);
    expect(first).toHaveLength(3);
    expect(first[0].pillar).toBe("Delegation");
    const cached = await proposeTopics(W);
    expect(cached).toEqual(first);
    expect((await pack()).topicsGeneratedAt).not.toBeNull();
  });

  it("starts a piece at Ideate from a topic, with its pillar", async () => {
    if (!dbReachable) return;
    const id = await startPiece(W, { topic: "Why I stopped fixing everything", format: "linkedin_post", pillarName: "Delegation" });
    const project = await getProject(W, id);
    expect(project?.stage).toBe("ideate");
    expect(project?.format).toBe("linkedin_post");
    expect(project?.name).toBe("Why I stopped fixing everything");
    // The pillar is kept on the piece before it has copy (0011), so the draft
    // lands under it rather than under "No pillar".
    expect(project?.pillarId).not.toBeNull();
    const P: ProjectScope = { ...W, projectId: id };
    await coWrite(P, { format: "linkedin_post", topic: "Delegation", pillarId: project!.pillarId });
    const [item] = await listContent(P);
    expect(item.pillarId).toBe(project!.pillarId);

    // A suggestion's pillar can carry its description; it still matches.
    const again = await startPiece(W, { topic: "Another", pillarName: "Delegation (handing work over)" });
    expect((await getProject(W, again))?.pillarId).toBe(project!.pillarId);
  });

  it("stores the person's own draft unchanged (check mine)", async () => {
    if (!dbReachable) return;
    const id = await startPiece(W, { topic: "My own words" });
    const P: ProjectScope = { ...W, projectId: id };
    await ownDraft(P, { format: "linkedin_post", topic: "My own words", text: "My hook.\n\nMy body, as I wrote it." });
    const [item] = await listContent(P);
    expect(item.hook).toBe("My hook.");
    expect(item.body).toBe("My body, as I wrote it.");
    expect(item.status).toBe("edited");
  });

  it("drafts an outline for them to fill in (co-write)", async () => {
    if (!dbReachable) return;
    const id = await startPiece(W, { topic: "Delegation" });
    const P: ProjectScope = { ...W, projectId: id };
    await coWrite(P, { format: "linkedin_post", topic: "Delegation" });
    const [item] = await listContent(P);
    expect(item.body).toContain("• ");
  });
});

describe("check", () => {
  it("applies the platform's limits and cites the person's own corpus", async () => {
    if (!dbReachable) return;
    const r = await checkText(W, "Let's dive in. " + "x".repeat(400), "x");
    expect(r.issues.map((i) => i.code)).toContain("platform_limit");
    const watch = r.issues.find((i) => i.code === "watch_phrase");
    expect(watch?.message).toMatch(/in \d+ pieces/);
  });

  it("returns findings that quote the draft, and a rewrite", async () => {
    if (!dbReachable) return;
    const draft = "We leverage the team every week.\nShort line.";
    const findings = await judgeText(W, draft, "linkedin");
    expect(findings[0]).toMatchObject({ line: "We leverage the team every week.", verdict: "off" });
    expect(await rewriteText(W, draft, "linkedin")).not.toMatch(/leverage/i);
  });

  it("counts approved pieces for the Deep question drip", async () => {
    if (!dbReachable) return;
    expect(await approvedPieceCount(W)).toBe(0);
  });
});

describe("isolation", () => {
  it("never lets one workspace add to or read another's corpus", async () => {
    if (!dbReachable) return;
    const p = await pack();
    expect(await addSamples(other, p.id, [{ body: "intruder" }])).toBe(0);
    expect(await listSamples(other, p.id)).toEqual([]);
  });

  it("refuses a cross-tenant child at the database even if the app check is bypassed (0010)", async () => {
    if (!dbReachable) return;
    const p = await pack();
    const raw = withTenantSession(other, (c) =>
      c.query(
        "INSERT INTO voice_samples (tenant_id, pack_id, body) VALUES ($1, $2, 'raw intruder')",
        [other.tenantId, p.id],
      ),
    );
    await expect(raw).rejects.toThrow(/foreign key/i);
  });

  it("won't attach another workspace's pillar to a piece (0011)", async () => {
    if (!dbReachable) return;
    const theirs = await createPillar(other, "Not yours");
    const id = await startPiece(W, { topic: "Mine" });
    // Through the app: the pillar isn't visible, so the pick is ignored.
    await setIdeate({ ...W, projectId: id }, { format: null, pillarId: theirs, angle: null, ideaId: null, topic: "" });
    expect((await getProject(W, id))?.pillarId).toBeNull();
    // Around the app: the database refuses the mismatched tenant.
    const raw = withTenantSession(W, (c) => c.query("UPDATE projects SET pillar_id = $1 WHERE id = $2", [theirs, id]));
    await expect(raw).rejects.toThrow(/foreign key/i);
  });
});

describe("closing the flow plan", () => {
  it("stores the scan's state, so Learning survives a refresh and ends as done", async () => {
    if (!dbReachable) return;
    await finishIngest(W, await pack());
    const scan = (await pack()).onboarding.scan;
    expect(scan?.state).toBe("done");
    expect(scan?.pieces).toBeGreaterThan(0);
  });

  it("previews a re-measure without changing anything", async () => {
    if (!dbReachable) return;
    const before = await pack();
    const changes = await previewRescan(W, before.id);
    expect(Array.isArray(changes)).toBe(true);
    const after = await pack();
    expect(after.version).toBe(before.version);
    expect(after.scannedAt).toBe(before.scannedAt);
  });

  it("edits the mirror in place: never-list replaced, an opener dropped, a line reworded", async () => {
    if (!dbReachable) return;
    await setNeverWords(W, owner, await pack(), ["Synergy", "hustle", "synergy"]);
    expect((await pack()).index.neverWords).toEqual(["synergy", "hustle"]);

    const p = await pack();
    const opener = p.mechanics.openers?.value[0]?.example;
    if (opener) {
      await dropOpener(W, owner, p, opener);
      expect((await pack()).mechanics.openers?.value.some((o) => o.example === opener)).toBe(false);
    }

    await answer(W, owner, await pack(), "D7", "I never name a client.");
    const id = (await pack()).guardrails.find((g) => g.id === "never-write")!.id;
    await setGuardrailRule(W, owner, await pack(), id, "I never name a client without asking.");
    expect((await pack()).guardrails.find((g) => g.id === id)?.rule).toBe("I never name a client without asking.");
    await setGuardrailRule(W, owner, await pack(), id, "");
    expect((await pack()).guardrails.some((g) => g.id === id)).toBe(false);
  });

  it("keeps only real colours in the hue", async () => {
    if (!dbReachable) return;
    const version = (await pack()).version;
    await saveVisualIdentity(W, { palette: ["#0A0A0A", "not a colour", "#ff3429"], fonts: ["Inter", " "], imageStyleNotes: " Real photos. " });
    expect(await loadVisualIdentity(W)).toEqual({ palette: ["#0A0A0A", "#ff3429"], fonts: ["Inter"], imageStyleNotes: "Real photos." });
    // A colour change is not a voice edit: no new voice version.
    expect((await pack()).version).toBe(version);
  });

  it("remembers a piece's voice score for the Library, without counting it as an edit (0012)", async () => {
    if (!dbReachable) return;
    const id = await startPiece(W, { topic: "Scored" });
    const P: ProjectScope = { ...W, projectId: id };
    const itemId = await ownDraft(P, { format: "linkedin_post", topic: "Scored", text: "In today's fast-paced world, let's dive in!!!\n\nWe leverage synergy." });
    const edited = async () =>
      (await withTenantSession(W, (c) => c.query<{ updated_at: Date }>("SELECT updated_at FROM content_items WHERE id = $1", [itemId]))).rows[0].updated_at.toISOString();
    const before = await edited();

    const r = await scoreContentItem(P, itemId);
    expect(r).not.toBeNull();
    expect(await edited()).toBe(before);

    const card = (await listProjects(W)).find((x) => x.id === id)!;
    expect(card.voiceScore).toBe(r!.score);
    expect(card.voiceBand).toBe(r!.band);
    expect(card.contentStatus).toBe("edited");
  });

  it("counts approved pieces since the last measure (the 90-day invite)", async () => {
    if (!dbReachable) return;
    expect(await approvedSince(W, null)).toBe(0);
    expect(await approvedSince(W, "2000-01-01T00:00:00Z")).toBeGreaterThanOrEqual(0);
  });
});
