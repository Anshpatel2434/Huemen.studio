/**
 * GET /settings/connections/[provider]/start?cap=gmail — begin a connection.
 *
 * Connections are account settings: they belong to the signed-in person, in
 * their own workspace, and feed their own voice. Asks only for the capability
 * being switched on (plus who the account is and what was already granted),
 * signs the state, keeps the nonce and PKCE verifier in an httpOnly cookie,
 * and sends the person to the provider.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resolveScope } from "@/lib/auth/scope";
import { getEnv } from "@/lib/env";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { ownsVoice } from "@/lib/data/training";
import { clientFor, listConnections, unavailableReason } from "@/lib/data/connections";
import { authorizeUrl, CAPABILITIES, PROVIDERS, redirectUri, scopesFor, type CapabilityKey, type ProviderKey } from "@/lib/integrations/providers";
import { encodeState, newNonce, pkcePair } from "@/lib/integrations/state";

const OAUTH_COOKIE = "huemen_oauth";

export async function GET(req: Request, ctx: RouteContext<"/settings/connections/[provider]/start">) {
  const { provider: p } = await ctx.params;
  const back = (msg: string) => NextResponse.redirect(new URL(`/settings/connections?error=${encodeURIComponent(msg)}`, req.url), 303);

  if (!(p in PROVIDERS)) return new Response("Not found", { status: 404 });
  const provider = p as ProviderKey;
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login?next=/settings/connections", req.url), 303);
  const scope = { ...(await resolveScope(session, session.tenantId)), tenantId: session.tenantId };

  const pack = await loadPackForWorkspace(scope);
  if (!pack || !ownsVoice({ userId: session.userId, role: session.role }, pack)) {
    return back("Connections feed your own voice, and there isn't one for this account yet.");
  }

  const capParam = new URL(req.url).searchParams.get("cap");
  const cap = capParam && capParam in CAPABILITIES ? (capParam as CapabilityKey) : null;
  if (cap && CAPABILITIES[cap].provider !== provider) return back("That doesn't belong to this provider.");
  const reason = cap ? unavailableReason(cap) : clientFor(provider) ? null : `${PROVIDERS[provider].label} isn't connected to this app yet.`;
  if (reason) return back(reason);

  const client = clientFor(provider)!;
  const env = getEnv();
  const existing = (await listConnections(scope)).find((c) => c.provider === provider);
  const nonce = newNonce();
  const pkce = PROVIDERS[provider].pkce ? pkcePair() : null;
  const state = encodeState({ t: session.tenantId, u: session.userId, p: provider, c: cap, n: nonce }, env.AUTH_SECRET);

  const res = NextResponse.redirect(
    authorizeUrl(provider, {
      clientId: client.clientId,
      redirectUri: redirectUri(env.APP_URL, provider),
      scopes: scopesFor(provider, cap, existing?.scopes ?? []),
      state,
      codeChallenge: pkce?.challenge,
      loginHint: existing?.accountEmail ?? undefined,
    }),
    303,
  );
  res.cookies.set(OAUTH_COOKIE, JSON.stringify({ n: nonce, v: pkce?.verifier ?? null }), {
    httpOnly: true,
    sameSite: "lax", // the provider's redirect back is a top-level GET
    secure: env.NODE_ENV === "production",
    path: "/connections/callback",
    maxAge: 600,
  });
  return res;
}
