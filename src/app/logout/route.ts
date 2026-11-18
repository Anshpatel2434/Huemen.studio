import { localRedirect } from "@/lib/local-redirect";
import { signOut } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * `/logout` is the address people type when they want out, and it used to 404.
 * Signing out proper is the POST form in the account menu; this ends the
 * session too and lands on the same confirmation, so the guessed URL does the
 * expected thing rather than showing a dead end.
 *
 * Only for a typed address or a link on this site: browsers send
 * Sec-Fetch-Site "none" or "same-origin" then. Another site embedding
 * /logout (an image tag) gets "cross-site" and signs nobody out
 * (2026-11-17 test). Redirects are relative, so the browser stays on its host.
 */
export async function GET(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "none" && site !== "same-origin") return localRedirect("/dashboard");
  await signOut();
  return localRedirect("/signed-out");
}
