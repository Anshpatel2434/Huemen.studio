/**
 * Audit L5 (2026-11-18): pillar lines that do not parse are named, not lost,
 * and a run that adds nothing says why. The model and the database are stubs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const st = vi.hoisted(() => ({
  reply: "" as string,
  existing: [] as string[],
  created: [] as string[],
}));

vi.mock("@/lib/ai", () => ({
  generateText: async () => ({ variants: [st.reply], model: "m", logId: null, warnings: [] }),
}));
vi.mock("@/lib/ai/templates", () => ({
  resolveTemplate: async () => ({ id: null, key: "pillar_set", version: 1, body: "Propose pillars." }),
}));
vi.mock("@/lib/context/context-loader", () => ({ loadBrandContext: async () => ({}) }));
vi.mock("@/lib/data/planning", () => ({
  listPillars: async () => st.existing.map((name) => ({ name })),
  createPillar: async (_scope: unknown, name: string) => {
    st.created.push(name);
  },
}));

import { generatePillars, parsePillarLines, parsePillarReport, tryGeneratePillars } from "@/lib/data/pipeline";
import type { WorkspaceScope } from "@/lib/data/projects";

const scope = { tenantId: "22222222-2222-4222-8222-222222222222", userId: null, isPlatformAdmin: false } as unknown as WorkspaceScope;

beforeEach(() => {
  st.reply = "";
  st.existing = [];
  st.created = [];
});

describe("parsePillarReport names the lines it drops (L5)", () => {
  it("keeps the pillar lines and lists each line it could not read", () => {
    const r = parsePillarReport("Contrarian takes :: Where I disagree\nHere are your pillars:\n- Proof :: Wins\n\nx :: too short a name");
    expect(r.pillars).toEqual([
      { name: "Contrarian takes", description: "Where I disagree" },
      { name: "Proof", description: "Wins" },
    ]);
    expect(r.dropped).toEqual(["Here are your pillars:", "x :: too short a name"]);
  });

  it("still parses the way it did (the list form the tests rely on)", () => {
    expect(parsePillarLines("1. Contrarian takes :: Where I disagree\n- Proof :: Wins\nnoise")).toEqual([
      { name: "Contrarian takes", description: "Where I disagree" },
      { name: "Proof", description: "Wins" },
    ]);
  });
});

describe("generatePillars says what happened (L5)", () => {
  it("a reply with no pillars in it adds none, and says so plainly", async () => {
    st.reply = "Sorry, I could not think of any.";
    const run = await generatePillars(scope);
    expect(run.added).toBe(0);
    expect(run.note).toMatch(/did not list any pillars/);
    expect(st.created).toEqual([]);
  });

  it("pillars that already exist are not added twice, and the run says so", async () => {
    st.existing = ["Proof"];
    st.reply = "Proof :: Wins";
    const run = await generatePillars(scope);
    expect(run.added).toBe(0);
    expect(run.note).toMatch(/already exists/);
  });

  it("adds the new pillars and reports the lines it skipped", async () => {
    st.reply = "Contrarian takes :: Where I disagree\nNoise line";
    const run = await generatePillars(scope);
    expect(run.added).toBe(1);
    expect(st.created).toEqual(["Contrarian takes"]);
    expect(run.dropped).toEqual(["Noise line"]);
    expect(run.note).toMatch(/One line was not in the Name :: description form and was skipped/);
  });

  it("a clean run has no note", async () => {
    st.reply = "Contrarian takes :: Where I disagree\nProof :: Wins";
    const run = await generatePillars(scope);
    expect(run).toEqual({ added: 2, dropped: [], note: null });
  });
});

describe("tryGeneratePillars returns the plain reason when nothing was added (L5)", () => {
  it("returns the note for a zero result", async () => {
    st.reply = "Nothing useful here.";
    expect(await tryGeneratePillars(scope)).toMatch(/did not list any pillars/);
  });

  it("returns null for a clean run", async () => {
    st.reply = "Proof :: Wins";
    expect(await tryGeneratePillars(scope)).toBeNull();
  });
});
