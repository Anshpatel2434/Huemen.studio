/**
 * GET /connections/callback/[provider] — the provider sends the person back here.
 *
 * One fixed URL per provider (that's what gets registered with Google and
 * LinkedIn); the workspace comes from the signed state. Checks, in order: the
 * state's signature and expiry, that it matches this browser's nonce cookie,
 * that the signed-in person is the one who started it, and that they still
 * have access to that workspace. Only then is the code exchanged. The person
 * lands back on Settings › Connections.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resolveScope } from "@/lib/auth/scope";
import { getEnv } from "@/lib/env";
import { clientFor, saveConnection } from "@/lib/data/connections";
import { exchangeCode, whoami, ConnectionError } from "@/lib/integrations/oauth";
import { PROVIDERS, redirectUri, scopesFor, type ProviderKey } from "@/lib/integrations/providers";
import { decodeState } from "@/lib/integrations/state";

const COOKIE = "huemen_oauth";

export async function GET(req: Request, ctx: RouteContext<"/connections/callback/[provider]">) {
  const { provider: p } = await ctx.params;
  if (!(p in PROVIDERS)) return new Response("Not found", { status: 404 });
  const provider = p as ProviderKey;
  const url = new URL(req.url);
  const env = getEnv();
  const cookie = (() => {
    try {
      const raw = req.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
      return JSON.parse(decodeURIComponent(raw ?? "%7B%7D")) as { n?: string; v?: string | null };
    } catch {
      return {};
    }
  })();
  // One use only: every answer from here clears the nonce cookie.
  const done = (res: NextResponse) => {
    res.cookies.set(COOKIE, "", { path: "/connections/callback", maxAge: 0 });
    return res;
  };

  const state = decodeState(url.searchParams.get("state") ?? "", env.AUTH_SECRET, cookie.n);
  if (!state || state.p !== provider) {
    return done(new NextResponse("This connection link has expired. Start again from your workspace.", { status: 400 }));
  }
  const to = (q: string) => done(NextResponse.redirect(new URL(`/settings/connections?${q}`, req.url), 303));

  // The person said no, or the provider refused: say so plainly.
  const denied = url.searchParams.get("error");
  if (denied) return to(`error=${encodeURIComponent(denied === "access_denied" ? "You didn't allow access, so nothing was connected." : "The provider didn't connect. Try again.")}`);

  const session = await getSession();
  if (!session || session.userId !== state.u) return done(new NextResponse("Sign in as the person who started this connection.", { status: 403 }));
  let scope;
  try {
    scope = { ...(await resolveScope(session, state.t)), tenantId: state.t };
  } catch {
    return done(new NextResponse("Not found", { status: 404 }));
  }

  const client = clientFor(provider);
  const code = url.searchParams.get("code");
  if (!client || !code) return to(`error=${encodeURIComponent("The connection didn't complete. Try again.")}`);

  try {
    const tokens = await exchangeCode(provider, client, {
      code,
      redirectUri: redirectUri(env.APP_URL, provider),
      codeVerifier: cookie.v ?? undefined,
      requestedScopes: scopesFor(provider, state.c),
    });
    const who = await whoami(provider, tokens.accessToken);
    await saveConnection(scope, provider, tokens, who);
    return to(`connected=${provider}${state.c ? `&cap=${state.c}` : ""}`);
  } catch (e) {
    const msg = e instanceof ConnectionError ? e.message : "The connection didn't complete. Try again.";
    return to(`error=${encodeURIComponent(msg)}`);
  }
}
