/**
 * Every way into the server checks who is asking (INV-1, TASKS P4-7).
 *
 * Each exported server action ("use server" files) and each route handler
 * (route.ts GET/POST/PUT/...) must establish a verified identity or scope
 * before it does anything: a session, a workspace/project scope, or a signed
 * link. The few that are deliberately public are listed below with the reason.
 * A new action or route that forgets its gate fails this test.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const GATES = [
  "requireSession(", "getSession(", "resolveScope(", "workspaceScope(", "projectScope(",
  "actionScope(", "actionProjectScope(", "actionActor(", "ctx(", "packFor(", "adminGlobalScope(",
  "verifyLink(", "verifyQuestionnaireToken(", "verifySignature(", "verifyPut(", "verifyState(",
];

/** Public on purpose. Key: "file#export". */
const PUBLIC: Record<string, string> = {
  "src/app/login/actions.ts#signInWithEmail": "sign-in itself: looks up an invited account and emails a link",
  "src/app/logout/route.ts#GET": "ends the caller's own session",
  "src/app/login/actions.ts#signInAs": "dev-only one-click sign-in; refuses unless AUTH_DRIVER=dev, which production refuses (lib/env)",
  "src/app/dashboard/actions.ts#signOutAction": "ends the caller's own session",
  "src/app/settings/actions.ts#saveThemeAction": "sets the caller's own theme cookie",
  "src/app/settings/actions.ts#saveCanvasAction": "sets the caller's own canvas cookie",
  "src/app/w/[id]/project-actions.ts#dismissHeroAction": "sets a per-browser cookie",
  "src/app/w/[id]/project-actions.ts#dismissWhatsNewAction": "sets a per-browser cookie",
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p.split("\\").join("/")];
  });
}

/** Top-level functions (exported or not) and the text of each, up to the next one. */
function functionsOf(src: string): { name: string; exported: boolean; body: string }[] {
  const re = /^(export )?(?:async )?function\*? (\w+)|^(export )?const (\w+) = (?:async )?\(/gm;
  const hits = [...src.matchAll(re)];
  return hits.map((m, i) => ({
    name: m[2] ?? m[4],
    exported: Boolean(m[1] ?? m[3]),
    body: src.slice(m.index!, hits[i + 1]?.index ?? src.length),
  }));
}

const files = walk("src/app");
const actions = files.filter((f) => /\.tsx?$/.test(f) && /^["']use server["']/m.test(readFileSync(f, "utf8")));
const routes = files.filter((f) => /\/route\.ts$/.test(f));

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
