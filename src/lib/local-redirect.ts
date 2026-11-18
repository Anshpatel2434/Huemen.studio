import { NextResponse } from "next/server";

/**
 * A redirect to a path on this site, sent as a RELATIVE Location header.
 *
 * `NextResponse.redirect(new URL(path, req.url))` resolves against the host
 * the server is bound to, which is not always the host the browser is on (a
 * proxy, www vs apex, a preview or custom domain, *.localhost in development).
 * A sign-in then set its cookie on one host and sent the person to another,
 * where they were signed out (2026-11-17 test). A relative Location keeps the
 * browser on whatever host it used. `path` must start with a single "/";
 * callers pass paths from safeNext() or literals, never user input as-is.
 */
export function localRedirect(path: string, status: 302 | 303 | 307 = 307): NextResponse {
  const safe = path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : "/";
  return new NextResponse(null, { status, headers: { Location: safe } });
}
