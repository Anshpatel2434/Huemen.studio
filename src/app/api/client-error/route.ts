/**
 * Errors from the browser (app/error.tsx, app/global-error.tsx) arrive here and
 * go to lib/observability/report, like server errors do.
 *
 * Only errors with no digest are kept: a digest means the error happened on
 * the server and instrumentation's onRequestError has already reported it.
 * What is left is a client component failing in the browser, which the server
 * never sees otherwise.
 *
 * Kept small and hard to abuse: same-origin only, signed-in people only, at
 * most 8 KB, and a per-person and per-instance limit per minute
 * (lib/observability/client-report). The answer is always 204, so the
 * endpoint tells a caller nothing.
 */
import { NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { getSession } from "@/lib/auth";
import { reportError } from "@/lib/observability/report";
import { allowReport, clientErrorFrom, CLIENT_REPORT_MAX_BYTES } from "@/lib/observability/client-report";

const none = () => new Response(null, { status: 204 });

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const sameOrigin = origin !== null && (origin === req.nextUrl.origin || origin === new URL(getEnv().APP_URL).origin);
  if (!sameOrigin || (req.headers.get("sec-fetch-site") ?? "same-origin") !== "same-origin") return none();
  if (Number(req.headers.get("content-length") ?? 0) > CLIENT_REPORT_MAX_BYTES) return none();

  const session = await getSession();
  if (!session || !allowReport(session.userId)) return none();

  const raw = await req.text();
  if (raw.length > CLIENT_REPORT_MAX_BYTES) return none();
  let report: ReturnType<typeof clientErrorFrom> = null;
  try {
    report = clientErrorFrom(JSON.parse(raw));
  } catch {
    return none();
  }
  if (!report) return none();

  await reportError(report.error, {
    source: "client",
    path: report.path,
    userId: session.userId,
    // A client's session names their one workspace; staff sessions name the org.
    tenantId: session.role === "client" ? session.tenantId : undefined,
    requestId: req.headers.get("x-vercel-id") ?? undefined,
  });
  return none();
}
