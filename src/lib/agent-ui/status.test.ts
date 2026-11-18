/**
 * Audit H5 (2026-11-18): the agent's score and checklist come from the brief,
 * not from the model. Pure: no React, no database.
 */
import { describe, it, expect } from "vitest";
import { buildBrandContext } from "@/lib/context/context-builder";
import { mockAgentAnswer } from "./mock";
import { agentTask, answerErrors } from "./prompt";
import { briefStatus, STATUS_FIX_PAGE } from "./status";
import { agentSpecLibrary } from "./spec";

describe("briefStatus: the score and open items are the brief's own", () => {
  it("takes the completeness score as it is, rounded and kept to 0-100", () => {
    expect(briefStatus(62, []).score).toBe(62);
    expect(briefStatus(61.6, []).score).toBe(62);
    expect(briefStatus(140, []).score).toBe(100);
    expect(briefStatus(-5, []).score).toBe(0);
    expect(briefStatus(Number.NaN, []).score).toBe(0);
  });

  it("lists exactly the gaps the brief reported, in its words, and drops blank ones", () => {
    const warnings = ["Niche is not defined.", "  No guardrails, nothing is off-limits.  ", ""];
    expect(briefStatus(40, warnings).open).toEqual(["Niche is not defined.", "No guardrails, nothing is off-limits."]);
  });

  it("works from a real brief: a thin brief shows its own gaps and a low score", () => {
    const thin = buildBrandContext({});
    const status = briefStatus(thin.completeness, thin.warnings);
    expect(status.score).toBe(thin.completeness);
    expect(status.open).toEqual(thin.warnings);
    expect(status.open.length).toBeGreaterThan(0);
  });

  it("points every open item at the Getting started page", () => {
    expect(STATUS_FIX_PAGE).toBe("setup");
  });
});

describe("the model cannot type a score or a done mark", () => {
  it("has no ScoreBar, Checklist or CheckItem in its language any more", () => {
    const names = Object.keys(agentSpecLibrary.components);
    expect(names).toContain("BriefStatus");
    expect(names).not.toContain("ScoreBar");
    expect(names).not.toContain("Checklist");
    expect(names).not.toContain("CheckItem");
  });

  it("BriefStatus takes no arguments, so a typed score has nowhere to go", () => {
    const out = answerErrors('root = Answer([s])\ns = BriefStatus()');
    expect(out.errors).toEqual([]);
    expect(out.unresolved).toEqual([]);
  });

  it("an answer that still types a score does not parse cleanly", () => {
    const out = answerErrors('root = Answer([s])\ns = ScoreBar("Brief", 99, "Trust me.")');
    expect(out.errors.length + out.unresolved.length).toBeGreaterThan(0);
  });

  it("the stand-in's status answer places BriefStatus and types no number", () => {
    const thin = buildBrandContext({});
    const task = agentTask({ question: "What's missing from my brief?", earlier: [], project: null, completeness: thin.completeness, warnings: thin.warnings });
    const program = mockAgentAnswer(thin, task);
    expect(program).toContain("BriefStatus()");
    expect(program).not.toMatch(/ScoreBar|CheckItem|Checklist/);
    const out = answerErrors(program);
    expect(out.errors).toEqual([]);
    expect(out.unresolved).toEqual([]);
  });
});
