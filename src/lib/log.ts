/**
 * Structured logging (brief §05: "structured logs, error tracking").
 *
 * One line per event. In production each line is JSON, so a hosting platform's
 * log search can filter on `event`, `tenantId` or `level` instead of grepping
 * prose; in development it stays readable. No dependency: a log library would
 * be one more thing the client has to understand at handover, and this is the
 * part of it we use.
 *
 * What never goes in a log line: prompt or draft text, a person's writing,
 * email addresses, tokens, or anything from `generation_logs`. Those have
 * their own home — `generation_logs` is the product-level audit trail and
 * `admin_audit_log` records who changed what. This is for operations: what
 * failed, where, and enough identifiers to find it.
 */
import { getEnv } from "./env";

export type Level = "debug" | "info" | "warn" | "error";

/** Identifiers worth attaching. Values are ids and short codes, never content. */
export interface LogContext {
  tenantId?: string;
  userId?: string;
  projectId?: string;
  /** e.g. "openai", "resend", "s3" — which outside thing was involved. */
  provider?: string;
  /** How long the thing took, when that is the point of the line. */
  ms?: number;
  [key: string]: string | number | boolean | null | undefined;
}

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Below this, nothing is emitted. Quiet in tests so a suite's output stays readable. */
function threshold(): number {
  const env = getEnv();
  if (env.NODE_ENV === "test") return ORDER.error;
  return ORDER[env.LOG_LEVEL];
}

/**
 * An Error reduced to what is safe and useful: its name, its message and —
 * outside production — its stack. A message can carry a provider's own text,
 * so it is capped rather than trusted to be short.
 */
function describe(err: unknown): Record<string, string> {
  if (err instanceof Error) {
    const out: Record<string, string> = { errorName: err.name, errorMessage: err.message.slice(0, 500) };
    if (getEnv().NODE_ENV !== "production" && err.stack) out.stack = err.stack.slice(0, 2000);
    return out;
  }
  return { errorMessage: String(err).slice(0, 500) };
}

function emit(level: Level, event: string, context: LogContext, extra?: Record<string, unknown>): void {
  if (ORDER[level] < threshold()) return;
  const line = { level, event, time: new Date().toISOString(), ...context, ...extra };
  // console is the transport on every host that collects stdout, which is all
  // of the ones in docs/hosting.md.
  const to = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (getEnv().NODE_ENV === "production") {
    to(JSON.stringify(line));
    return;
  }
  const rest = Object.entries(line).filter(([k]) => !["level", "event", "time"].includes(k));
  to(`[${level}] ${event}${rest.length ? ` ${rest.map(([k, v]) => `${k}=${v}`).join(" ")}` : ""}`);
}

export const log = {
  debug: (event: string, context: LogContext = {}) => emit("debug", event, context),
  info: (event: string, context: LogContext = {}) => emit("info", event, context),
  warn: (event: string, context: LogContext = {}) => emit("warn", event, context),
  /**
   * Something failed. `event` names the thing that failed, in the same
   * dotted form everywhere ("mail.send", "ai.text", "storage.put"), so one
   * filter finds every occurrence across releases.
   */
  error: (event: string, err: unknown, context: LogContext = {}) =>
    emit("error", event, context, describe(err)),
};

/**
 * Report an error to whatever the deployment uses to watch for them, and log
 * it either way. ERROR_WEBHOOK_URL is a deliberate seam rather than a vendor:
 * picking the error tracker is the client's call at handover, and a webhook
 * is what every one of them accepts. Never throws — a reporting failure must
 * not become the error the user sees.
 */
export async function reportError(event: string, err: unknown, context: LogContext = {}): Promise<void> {
  log.error(event, err, context);
  const url = getEnv().ERROR_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, ...context, ...describe(err), app: "huemen.studio" }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (e) {
    log.warn("error_report.failed", { reason: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
  }
}
