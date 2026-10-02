/**
 * The OAuth 2 calls every provider shares: swap a code for tokens, refresh,
 * revoke, and ask who the account is. Plain fetch, injectable for tests.
 *
 * Failures come back as ConnectionError with a kind the page can speak about
 * ("reconnect", "try again"), never a raw provider body.
 *
 * Server-only.
 */
import { PROVIDERS, type ProviderKey } from "./providers";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type ConnectionErrorKind = "auth" | "revoked" | "rate_limit" | "server" | "bad_request" | "network" | "not_enabled";

export class ConnectionError extends Error {
  constructor(public readonly kind: ConnectionErrorKind, message: string) {
    super(message);
    this.name = "ConnectionError";
  }
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scopes: string[];
}

export interface Identity {
  id: string;
  email: string | null;
  name: string | null;
}

export interface Client {
  clientId: string;
  clientSecret: string;
}

const TIMEOUT_MS = 20_000;

export async function call(fetchImpl: FetchLike, url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new ConnectionError("network", "Couldn't reach the provider.");
  }
  if (res.ok) return res;
  const body = await res.text().catch(() => "");
  if (res.status === 401) throw new ConnectionError("auth", "The provider no longer accepts this connection.");
  if (res.status === 400 && /invalid_grant/.test(body)) throw new ConnectionError("revoked", "Access was withdrawn at the provider.");
  if (res.status === 403) throw new ConnectionError("auth", "The provider refused: this permission wasn't granted.");
  if (res.status === 429) throw new ConnectionError("rate_limit", "The provider asked us to slow down.");
  if (res.status >= 500) throw new ConnectionError("server", "The provider had a problem.");
  throw new ConnectionError("bad_request", `The provider rejected the request (${res.status}).`);
}

const parseScopes = (s: unknown) =>
  typeof s === "string" ? s.split(/[\s,]+/).filter(Boolean) : [];

function tokens(body: Record<string, unknown>, now: number, fallbackScopes: string[]): TokenSet {
  if (typeof body.access_token !== "string") throw new ConnectionError("bad_request", "The provider sent no access token.");
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : Number(body.expires_in);
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expiresAt: Number.isFinite(expiresIn) ? new Date(now + expiresIn * 1000).toISOString() : null,
    scopes: body.scope ? parseScopes(body.scope) : fallbackScopes,
  };
}

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const FORM = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };

export async function exchangeCode(
  provider: ProviderKey,
  client: Client,
  input: { code: string; redirectUri: string; codeVerifier?: string; requestedScopes: string[] },
  fetchImpl: FetchLike = fetch,
  now = Date.now(),
): Promise<TokenSet> {
  const body: Record<string, string> = {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: client.clientId,
    client_secret: client.clientSecret,
  };
  if (input.codeVerifier) body.code_verifier = input.codeVerifier;
  const res = await call(fetchImpl, PROVIDERS[provider].tokenUrl, { method: "POST", headers: FORM, body: form(body) });
  return tokens((await res.json()) as Record<string, unknown>, now, input.requestedScopes);
}

/** A fresh access token. The refresh token is kept when the provider doesn't send a new one. */
export async function refresh(
  provider: ProviderKey,
  client: Client,
  current: { refreshToken: string; scopes: string[] },
  fetchImpl: FetchLike = fetch,
  now = Date.now(),
): Promise<TokenSet> {
  const res = await call(fetchImpl, PROVIDERS[provider].tokenUrl, {
    method: "POST",
    headers: FORM,
    body: form({
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    }),
  });
  const t = tokens((await res.json()) as Record<string, unknown>, now, current.scopes);
  return { ...t, refreshToken: t.refreshToken ?? current.refreshToken };
}

/** Best effort: the connection is removed here whether or not the provider answers. */
export async function revoke(provider: ProviderKey, client: Client, token: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  const url = PROVIDERS[provider].revokeUrl;
  if (!url) return false;
  try {
    const body = provider === "google"
      ? form({ token })
      : form({ token, client_id: client.clientId, client_secret: client.clientSecret });
    await call(fetchImpl, url, { method: "POST", headers: FORM, body });
    return true;
  } catch {
    return false;
  }
}

const USERINFO: Record<ProviderKey, string> = {
  google: "https://openidconnect.googleapis.com/v1/userinfo",
  linkedin: "https://api.linkedin.com/v2/userinfo",
};

export async function whoami(provider: ProviderKey, accessToken: string, fetchImpl: FetchLike = fetch): Promise<Identity> {
  const res = await call(fetchImpl, USERINFO[provider], { headers: { Authorization: `Bearer ${accessToken}` } });
  const b = (await res.json()) as Record<string, unknown>;
  if (typeof b.sub !== "string") throw new ConnectionError("bad_request", "The provider didn't say whose account this is.");
  return {
    id: b.sub,
    email: typeof b.email === "string" ? b.email : null,
    name: typeof b.name === "string" ? b.name : null,
  };
}
