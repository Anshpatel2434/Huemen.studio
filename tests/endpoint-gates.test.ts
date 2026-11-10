/**
 * Every way into the server checks who is asking (INV-1, TASKS P4-7).
 *
 * Each exported server action ("use server" files) and each route handler
 * (route.ts GET/POST/PUT/...) must establish a verified identity or scope
 * before it does anything: a session, a workspace/project scope, or a signed
 * link. The few that are deliberately public are listed in tests/helpers/endpoints.ts
 * (PUBLIC), each with the reason.
 * A new action or route that forgets its gate fails this test.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PUBLIC, actionFiles as actions, functionsOf, routeFiles as routes } from "./helpers/endpoints";

const GATES = [
  "requireSession(", "getSession(", "resolveScope(", "workspaceScope(", "projectScope(",
  "actionScope(", "actionProjectScope(", "actionActor(", "ctx(", "packFor(", "adminGlobalScope(",
  "verifyLink(", "verifyQuestionnaireToken(", "verifySignature(", "verifyPut(", "verifyState(",
];

function ungated(list: string[], only?: RegExp): string[] {
  const out: string[] = [];
  for (const f of list) {
    const src = readFileSync(f, "utf8");
    const fns = functionsOf(src);
    const direct = (body: string) => GATES.some((g) => body.includes(g));
    for (const e of fns.filter((x) => x.exported && (!only || only.test(x.name)))) {
      if (PUBLIC[`${f}#${e.name}`]) continue;
      // Gated itself, or calls another function of the same file that is.
      const gated = direct(e.body) || fns.some((o) => o.name !== e.name && e.body.includes(`${o.name}(`) && direct(o.body));
      if (!gated) out.push(`${f}#${e.name}`);
    }
  }
  return out;
}

describe("every endpoint checks who is asking", () => {
  it("finds the server actions and routes", () => {
    expect(actions.length).toBeGreaterThan(15);
    expect(routes.length).toBeGreaterThan(10);
  });
  it("server actions", () => {
    expect(ungated(actions)).toEqual([]);
  });
  it("route handlers", () => {
    expect(ungated(routes, /^(GET|POST|PUT|PATCH|DELETE)$/)).toEqual([]);
  });
});
