/**
 * Server errors from pages, route handlers, server actions and the proxy are
 * handed to Next here, once each, and go to lib/observability/report: always
 * the log, and Sentry when SENTRY_DSN is set.
 *
 * Only ids and the path travel with an error: request headers (cookies,
 * session) are deliberately not passed on.
 */
import type { Instrumentation } from "next";

/** Next's own control flow (redirect, notFound, dynamic bail-outs), not failures. */
const CONTROL_FLOW = /^(NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING|HANGING_PROMISE_REJECTION)/;

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  if (digest && CONTROL_FLOW.test(digest)) return;
  const header = (name: string) => {
    const v = request.headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  const { reportError } = await import("@/lib/observability/report");
  await reportError(err, {
    // Workspace pages carry the workspace id in the path (/w/<id>/...).
    tenantId: request.path.match(/^\/w\/([0-9a-f-]{36})(?:[/?]|$)/i)?.[1],
    source: context.routeType,
    route: context.routePath,
    method: request.method,
    path: request.path,
    digest,
    // Vercel's id for the request, so the log line and the platform's request log meet.
    requestId: header("x-vercel-id") ?? header("x-request-id"),
    extra: { renderSource: context.renderSource, revalidateReason: context.revalidateReason },
  });
};
