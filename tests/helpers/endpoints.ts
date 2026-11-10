/**
 * Every way into the server, found from the files themselves: the exported
 * server actions ("use server" files under src/app) and the route handlers
 * (route.ts GET/POST/...). Shared by the static gate check
 * (tests/endpoint-gates.test.ts) and the cross-tenant HTTP and action tests
 * (tests/cross-tenant-endpoints.test.ts), so a new endpoint is seen by both.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Public on purpose. Key: "file#export". */
export const PUBLIC: Record<string, string> = {
  "src/app/login/actions.ts#signInWithEmail": "sign-in itself: looks up an invited account and emails a link",
  "src/app/logout/route.ts#GET": "ends the caller's own session",
  "src/app/api/health/route.ts#GET": "uptime check: says only whether the database answers",
  "src/app/login/actions.ts#signInAs": "dev-only one-click sign-in; refuses unless AUTH_DRIVER=dev, which production refuses (lib/env)",
  "src/app/dashboard/actions.ts#signOutAction": "ends the caller's own session",
  "src/app/settings/actions.ts#saveThemeAction": "sets the caller's own theme cookie",
  "src/app/settings/actions.ts#saveCanvasAction": "sets the caller's own canvas cookie",
  "src/app/w/[id]/project-actions.ts#dismissHeroAction": "sets a per-browser cookie",
  "src/app/w/[id]/project-actions.ts#dismissWhatsNewAction": "sets a per-browser cookie",
};

export function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p.split("\\").join("/")];
  });
}

/** Top-level functions (exported or not) and the text of each, up to the next one. */
export function functionsOf(src: string): { name: string; exported: boolean; body: string }[] {
  const re = /^(export )?(?:async )?function\*? (\w+)|^(export )?const (\w+) = (?:async )?\(/gm;
  const hits = [...src.matchAll(re)];
  return hits.map((m, i) => ({
    name: m[2] ?? m[4],
    exported: Boolean(m[1] ?? m[3]),
    body: src.slice(m.index!, hits[i + 1]?.index ?? src.length),
  }));
}

const files = walk("src/app");
export const actionFiles = files.filter((f) => /\.tsx?$/.test(f) && /^["']use server["']/m.test(readFileSync(f, "utf8")));
export const routeFiles = files.filter((f) => /\/route\.ts$/.test(f));

export const HTTP_METHOD = /^(GET|POST|PUT|PATCH|DELETE)$/;

/** Every exported action and route handler, as "file#export". */
export function endpointKeys(): string[] {
  const out: string[] = [];
  for (const f of actionFiles) {
    for (const e of functionsOf(readFileSync(f, "utf8")).filter((x) => x.exported)) out.push(`${f}#${e.name}`);
  }
  for (const f of routeFiles) {
    for (const e of functionsOf(readFileSync(f, "utf8")).filter((x) => x.exported && HTTP_METHOD.test(x.name))) out.push(`${f}#${e.name}`);
  }
  return out;
}
