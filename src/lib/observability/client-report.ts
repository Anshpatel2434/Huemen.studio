/**
 * The server half of browser error reports (app/api/client-error): a small
 * per-minute limit, and turning the posted JSON into an Error worth sending.
 * Pure, so it is tested directly.
 */

export const CLIENT_REPORT_MAX_BYTES = 8 * 1024;
const PER_PERSON_PER_MINUTE = 10;
const PER_INSTANCE_PER_MINUTE = 120;

const hits = new Map<string, { n: number; until: number }>();

/**
 * True when `who` may send another report this minute. In memory, per server
 * instance: a cold start forgets it, which is fine for a cap on noise.
 */
export function allowReport(who: string, now = Date.now()): boolean {
  if (hits.size > 5000) hits.clear();
  const room = (k: string, max: number) => {
    const h = hits.get(k);
    return !h || h.until <= now || h.n < max;
  };
  if (!room("*", PER_INSTANCE_PER_MINUTE) || !room(who, PER_PERSON_PER_MINUTE)) return false;
  for (const k of ["*", who]) {
    const h = hits.get(k);
    if (!h || h.until <= now) hits.set(k, { n: 1, until: now + 60_000 });
    else h.n++;
  }
  return true;
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * The browser's error as an Error, or null when there is nothing to report:
 * not an object, or it has a digest (a server error, already reported by
 * instrumentation's onRequestError).
 */
export function clientErrorFrom(body: unknown): { error: Error; path: string } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (b.digest) return null;
  const name = text(b.name, 80).replace(/[^\w.$-]/g, "") || "Error";
  const message = text(b.message, 500);
  const error = new Error(message);
  error.name = name;
  const frames = text(b.stack, 4000).split("\n").filter((l) => /^\s*at /.test(l) || /@.+:\d+:\d+$/.test(l)).slice(0, 30);
  error.stack = `${name}: ${message}${frames.length ? `\n${frames.join("\n")}` : ""}`;
  return { error, path: text(b.path, 300).split("?")[0] };
}
