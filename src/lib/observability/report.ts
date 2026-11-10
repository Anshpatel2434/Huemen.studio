/**
 * Error tracking. `reportError` always writes the error to the log (./log,
 * stderr), and when SENTRY_DSN is set also sends it to Sentry.
 *
 * Sentry is reached over its plain HTTP envelope endpoint with fetch, not its
 * SDK: nothing to initialise, nothing patched into Node, nothing sent unless a
 * DSN is set. The Sentry account must be in the client's own name.
 *
 * It never throws and never holds a response for long: the send gives up
 * after REPORT_TIMEOUT_MS, and a failed send is logged as a warning. The same
 * error object is reported once, however many layers catch it.
 *
 * What is sent: the error's type, scrubbed message and stack frames, the
 * route, the request's path without its query, and ids (tenant, user,
 * request). Never cookies, headers, bodies or brand content.
 */
import { getEnv } from "@/lib/env";
import { logger, redact, scrub } from "./log";

export interface ReportContext {
  tenantId?: string | null;
  userId?: string | null;
  /** Route file path, e.g. /w/[id]/brand. */
  route?: string;
  /** render | route | action | proxy | client | job ... */
  source?: string;
  method?: string;
  /** The request path. Its query string is dropped (it can carry tokens). */
  path?: string;
  requestId?: string;
  digest?: string;
  /** Further ids or counts; redacted like log fields. */
  extra?: Record<string, unknown>;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** For tests: a DSN, environment or fetch other than the configured ones. */
export interface ReportDeps {
  dsn?: string | null;
  environment?: string;
  release?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export const REPORT_TIMEOUT_MS = 2000;

const reported = new WeakSet<object>();

/** Where and how to send to Sentry, from a DSN like https://<key>@o1.ingest.sentry.io/<project>. */
export function parseDsn(dsn: string): { url: string; publicKey: string } | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.split("/").filter(Boolean).pop();
    if (!u.username || !projectId || !/^\d+$/.test(projectId) || !/^https?:$/.test(u.protocol)) return null;
    const prefix = u.pathname.slice(0, u.pathname.lastIndexOf(`/${projectId}`));
    return { url: `${u.protocol}//${u.host}${prefix}/api/${projectId}/envelope/`, publicKey: decodeURIComponent(u.username) };
  } catch {
    return null;
  }
}

interface Frame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

/** V8 stack lines as Sentry frames, oldest call first (as Sentry wants them). */
export function stackFrames(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const line of stack.split("\n").slice(1, 51)) {
    const m = line.match(/^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/);
    if (!m) continue;
    const filename = scrub(m[2]);
    frames.push({
      function: m[1] ? scrub(m[1]) : undefined,
      filename,
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !/node_modules|^node:|^internal\//.test(filename),
    });
  }
  return frames.reverse();
}

const hex32 = () => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
};

/** The Sentry event for one error. Exported for tests. */
export function buildEvent(err: unknown, context: ReportContext, meta: { environment: string; release?: string; eventId: string; now: Date }) {
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : "Non-error thrown");
  const tags: Record<string, string> = {};
  if (context.source) tags.source = context.source;
  if (context.route) tags.route = scrub(context.route);
  if (context.method) tags.method = context.method;
  if (context.digest) tags.digest = context.digest;
  if (context.tenantId) tags.tenant_id = context.tenantId;
  return {
    event_id: meta.eventId,
    timestamp: meta.now.getTime() / 1000,
    platform: "node",
    level: "error",
    logger: "huemen",
    environment: meta.environment,
    ...(meta.release ? { release: meta.release } : {}),
    exception: {
      values: [{ type: e.name || "Error", value: scrub(e.message || ""), stacktrace: { frames: stackFrames(e.stack) } }],
    },
    tags,
    ...(context.userId ? { user: { id: context.userId } } : {}),
    ...(context.path || context.method ? { request: { method: context.method, url: context.path ? scrub(context.path.split("?")[0]) : undefined } } : {}),
    extra: redact({ requestId: context.requestId, ...context.extra }),
  };
}

/** The envelope body: a header line, an item header line, and the event. */
export function envelope(event: { event_id: string }, dsn: string, now: Date): string {
  const payload = JSON.stringify(event);
  return [
    JSON.stringify({ event_id: event.event_id, sent_at: now.toISOString(), dsn }),
    JSON.stringify({ type: "event", content_type: "application/json", length: new TextEncoder().encode(payload).byteLength }),
    payload,
  ].join("\n") + "\n";
}

function configured(deps: ReportDeps): { dsn: string | null; environment: string } {
  let env: ReturnType<typeof getEnv> | null = null;
  try {
    env = getEnv();
  } catch {
    // Invalid config already stops the app elsewhere; reporting must not throw on top.
  }
  return {
    dsn: "dsn" in deps ? (deps.dsn ?? null) : (env?.SENTRY_DSN ?? null),
    environment: deps.environment ?? env?.SENTRY_ENVIRONMENT ?? env?.NODE_ENV ?? "development",
  };
}

/**
 * Log an error and, with SENTRY_DSN set, send it to Sentry. Never throws.
 * Resolves once the send has finished, failed or timed out.
 */
export async function reportError(err: unknown, context: ReportContext = {}, deps: ReportDeps = {}): Promise<void> {
  try {
    if (typeof err === "object" && err !== null) {
      if (reported.has(err)) return;
      reported.add(err);
    }
    logger.error(err instanceof Error ? err.message || err.name : "error", {
      err,
      tenantId: context.tenantId ?? undefined,
      userId: context.userId ?? undefined,
      route: context.route,
      source: context.source,
      method: context.method,
      path: context.path?.split("?")[0],
      requestId: context.requestId,
      digest: context.digest,
      ...(context.extra ? { extra: context.extra } : {}),
    });

    const { dsn, environment } = configured(deps);
    if (!dsn) return;
    const target = parseDsn(dsn);
    if (!target) {
      logger.warn("error report not sent: SENTRY_DSN is not a valid DSN");
      return;
    }
    const now = new Date();
    const event = buildEvent(err, context, { environment, release: deps.release, eventId: hex32(), now });
    const res = await (deps.fetch ?? fetch)(target.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${target.publicKey}, sentry_client=huemen-studio/1.0`,
      },
      body: envelope(event, dsn, now),
      signal: AbortSignal.timeout(deps.timeoutMs ?? REPORT_TIMEOUT_MS),
    });
    if (!res.ok) logger.warn("error report not accepted", { status: res.status });
  } catch (e) {
    try {
      logger.warn("error report not sent", { reason: e instanceof Error ? e.name : "unknown" });
    } catch {
      // Nothing left to do.
    }
  }
}
