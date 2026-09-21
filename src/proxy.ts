import { NextResponse, type NextRequest } from "next/server";

/**
 * Signed-out visitors to app pages go to sign-in, carrying where they were
 * headed (`next`) so they land back there after the one-time link. This only
 * checks that a session cookie is present; the signature and access rules
 * are still checked on the server for every page and action (lib/auth).
 */
export function proxy(req: NextRequest) {
  if (req.cookies.has("huemen_session")) return NextResponse.next();
  const url = req.nextUrl.clone();
  const next = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  url.pathname = "/login";
  url.search = next === "/dashboard" ? "" : `?${new URLSearchParams({ next, e: "signin" })}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/dashboard", "/w/:path*", "/settings/:path*", "/admin/:path*"],
};
