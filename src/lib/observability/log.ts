/**
 * A small structured logger: one JSON object per line, so the host's log
 * search (Vercel, or anything reading stdout) can filter on fields.
 *
 *   {"time":"2026-11-11T09:30:00.000Z","level":"warn","msg":"mail not sent","tenantId":"...","status":422}
 *
 * Streams matter: hosts classify a line by the stream it arrives on, and count
 * everything on stderr as an error. So debug and info go to stdout, and only
 * warn and error go to stderr.
 *
 * What never reaches a log line: secrets, cookies, tokens, signed links, email
 * bodies and brand content. Fields under a sensitive name are replaced with
 * "[redacted]" at any depth (see SENSITIVE), and every string is scrubbed of
 * credentials in URLs, bearer tokens, signed-link parameters and email
 * addresses. Pass ids and counts, not content.
 *
 * No dependencies and no `server-only`: it is used by instrumentation, route
 * handlers and the CLI database scripts alike. Debug lines are dropped in
 * production.
 */

export type Level = "debug" | "info" | "warn" | "error";

/** Fields every line may carry. Anything else is allowed and redacted the same way. */
export interface LogFields {
  tenantId?: string | null;
  userId?: string | null;
  route?: string;
  requestId?: string;
  err?: unknown;
  [key: string]: unknown;
}

/**
 * Field names whose values are never written, matched with case, "-" and "_"
 * ignored. Secrets match as a whole name or the end of one ("resetToken",
 * "x-api-key", "set-cookie"); content names match whole only, so "context" or
 * "invoice" are not caught by "text" or "voice".
 */
const SECRET_SUFFIXES = [
  "password", "passwd", "secret", "token", "cookie", "cookies", "authorization", "apikey", "signature",
  "credential", "credentials", "privatekey", "connectionstring", "dsn",
];
const SENSITIVE_NAMES = [
  "key", "auth", "sig", "session", "link", "headers",
  // Content: email bodies and brand material are the client's, not ours to log.
  "body", "html", "text", "content", "prompt", "completion", "brief", "brand", "voice", "transcript", "subject", "lines",
];
const normalise = (k: string) => k.toLowerCase().replace(/[-_\s]/g, "");
const SUFFIXES = SECRET_SUFFIXES.map(normalise);
const NAMES = new Set([...SECRET_SUFFIXES, ...SENSITIVE_NAMES].map(normalise));
/** Names that end in a secret word but are only ids or counts. */
const ALLOWED = new Set(["storagekey", "tokencount", "inputtokens", "outputtokens", "maxtokens"]);

export function isSensitiveKey(key: string): boolean {
  const k = normalise(key);
  if (ALLOWED.has(k)) return false;
  return NAMES.has(k) || SUFFIXES.some((s) => k.endsWith(s));
}

const MAX_STRING = 2000;
const MAX_ITEMS = 20;
const MAX_DEPTH = 4;

/** Credentials in URLs, bearer tokens, signed-link parameters and email addresses, removed from a string. */
export function scrub(s: string): string {
  const out = s
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, "$1 [redacted]")
    .replace(/([?&](?:token|put|sig|signature|key|code|state|access_token|refresh_token|X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|sentry_key)=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, "$1***@$2");
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}...[truncated]` : out;
}

/** An Error as plain fields: name, message, code, digest and stack, all scrubbed. */
export function serialiseError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { message: scrub(typeof err === "string" ? err : safeString(err)) };
  const e = err as Error & { code?: unknown; digest?: unknown; status?: unknown };
  const out: Record<string, unknown> = { name: e.name, message: scrub(e.message) };
  if (typeof e.code === "string" || typeof e.code === "number") out.code = e.code;
  if (typeof e.digest === "string") out.digest = e.digest;
  if (typeof e.status === "number") out.status = e.status;
  if (e.stack) out.stack = scrub(e.stack.split("\n").slice(0, 15).join("\n"));
  if (e.cause !== undefined) out.cause = e.cause instanceof Error ? { name: e.cause.name, message: scrub(e.cause.message) } : "[cause]";
  return out;
}

function safeString(v: unknown): string {
  try {
    return String(v);
  } catch {
    return "[unprintable]";
  }
}

/** A copy of `value` that is safe to write: sensitive keys redacted, strings scrubbed, size bounded. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrub(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return serialiseError(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "[invalid date]" : value.toISOString();
  if (typeof value !== "object") return `[${typeof value}]`;
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return `[${value.byteLength} bytes]`;
  if (depth >= MAX_DEPTH) return "[nested]";
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((v) => redact(v, depth + 1));
    return value.length > MAX_ITEMS ? [...items, `[+${value.length - MAX_ITEMS} more]`] : items;
  }
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(value)) {
    if (n++ >= MAX_ITEMS * 2) {
      out["[more]"] = true;
      break;
    }
    out[k] = isSensitiveKey(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

const RESERVED = new Set(["time", "level", "msg"]);

/** The JSON line for one entry. Exported for tests. */
export function formatLine(level: Level, msg: string, fields: LogFields = {}, now = new Date()): string {
  const entry: Record<string, unknown> = { time: now.toISOString(), level, msg: scrub(msg) };
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || RESERVED.has(k)) continue;
    entry[k] = k === "err" ? serialiseError(v) : isSensitiveKey(k) ? "[redacted]" : redact(v);
  }
  try {
    return JSON.stringify(entry);
  } catch {
    return JSON.stringify({ time: entry.time, level, msg: entry.msg, note: "fields could not be serialised" });
  }
}

type Stream = { write(chunk: string): unknown };

function streamFor(level: Level): Stream {
  const proc = (globalThis as { process?: { stdout?: Stream; stderr?: Stream } }).process;
  const toErr = level === "warn" || level === "error";
  const s = toErr ? proc?.stderr : proc?.stdout;
  if (s && typeof s.write === "function") return s;
  // Edge runtime: no process streams. console.log is stdout, console.error stderr.
  return { write: (line: string) => (toErr ? console.error : console.log)(line.replace(/\n$/, "")) };
}

function isProduction(): boolean {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.NODE_ENV === "production";
}

export function log(level: Level, msg: string, fields?: LogFields): void {
  if (level === "debug" && isProduction()) return;
  try {
    streamFor(level).write(`${formatLine(level, msg, fields)}\n`);
  } catch {
    // A logger that throws takes the request down with it. Drop the line instead.
  }
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** A logger that adds `fields` (tenantId, route, requestId...) to every line. */
  child(fields: LogFields): Logger;
}

function make(base: LogFields): Logger {
  const at = (level: Level) => (msg: string, fields?: LogFields) => log(level, msg, { ...base, ...fields });
  return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error"), child: (more) => make({ ...base, ...more }) };
}

export const logger: Logger = make({});
