/**
 * Connections: one per person per provider (migration 0013).
 *
 * Tokens are sealed before they reach the database and opened only here, for
 * the one call that needs them. A connection belongs to the person who made it:
 * every read is filtered to the session's own user, so a coach working in a
 * client's workspace never sees, uses or imports through the client's account,
 * and the client never imports through the coach's.
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession } from "@/db/session";
import { getEnv } from "@/lib/env";
import { open, seal } from "@/lib/integrations/crypto";
import {
  ConnectionError, refresh, revoke, type Client, type FetchLike, type Identity, type TokenSet,
} from "@/lib/integrations/oauth";
import {
  CAPABILITIES, capabilitiesOf, hasCapability, type CapabilityKey, type ProviderKey,
} from "@/lib/integrations/providers";
import type { ImportedPiece } from "@/lib/integrations/google";
import { addSamples } from "./voice-pack";
import type { WorkspaceScope } from "./projects";
import type { VoicePack } from "@/lib/voice/types";

export interface SyncState {
  at: string;
  count: number;
  error?: string;
}

export interface ConnectionView {
  id: string;
  provider: ProviderKey;
  status: "connected" | "expired" | "error";
  accountEmail: string | null;
  accountName: string | null;
  scopes: string[];
  sync: Partial<Record<CapabilityKey, SyncState>>;
  lastError: string | null;
  granted: CapabilityKey[];
  importedPieces: number;
}

interface Row {
  id: string;
  provider: ProviderKey;
  status: ConnectionView["status"];
  account_email: string | null;
  account_name: string | null;
  account_id: string | null;
  scopes: string[];
  access_token_enc: string;
  refresh_token_enc: string | null;
  expires_at: Date | null;
  sync: ConnectionView["sync"];
  last_error: string | null;
  imported: number;
}

/** The provider's app credentials, or null when this provider isn't set up here. */
export function clientFor(provider: ProviderKey): Client | null {
  const env = getEnv();
  const id = provider === "google" ? env.GOOGLE_CLIENT_ID : env.LINKEDIN_CLIENT_ID;
  const secret = provider === "google" ? env.GOOGLE_CLIENT_SECRET : env.LINKEDIN_CLIENT_SECRET;
  return id && secret && env.CONNECTIONS_KEY ? { clientId: id, clientSecret: secret } : null;
}

/** Why a capability can't be offered here yet, in plain words; null when it can. */
export function unavailableReason(cap: CapabilityKey): string | null {
  const c = CAPABILITIES[cap];
  const env = getEnv();
  if (!clientFor(c.provider)) return `${c.provider === "google" ? "Google" : "LinkedIn"} isn't connected to this app yet.`;
  if (cap === "posts" && !env.LINKEDIN_POSTS_APPROVED) return "LinkedIn only lets approved partners read your posts. Upload your LinkedIn data export instead.";
  if (cap === "docs" && (!env.GOOGLE_PICKER_API_KEY || !env.GOOGLE_PROJECT_NUMBER)) return "The Google Docs picker isn't set up yet.";
  return null;
}

const SELECT = `SELECT c.*, (SELECT count(*)::int FROM voice_samples s WHERE s.connection_id = c.id) AS imported FROM connections c`;

const view = (r: Row): ConnectionView => ({
  id: r.id,
  provider: r.provider,
  status: r.status,
  accountEmail: r.account_email,
  accountName: r.account_name,
  scopes: r.scopes,
  sync: r.sync ?? {},
  lastError: r.last_error,
  granted: capabilitiesOf(r.provider).filter((c) => c.scopes.length === 0 || hasCapability(c.key, r.scopes)).map((c) => c.key),
  importedPieces: r.imported,
});

async function row(scope: WorkspaceScope, provider: ProviderKey): Promise<Row | null> {
  if (!scope.userId) return null;
  return (
    await withTenantSession(scope, (c) =>
      c.query<Row>(`${SELECT} WHERE c.user_id = $1 AND c.provider = $2`, [scope.userId, provider]),
    )
  ).rows[0] ?? null;
}

export async function listConnections(scope: WorkspaceScope): Promise<ConnectionView[]> {
  if (!scope.userId) return [];
  return (
    await withTenantSession(scope, (c) => c.query<Row>(`${SELECT} WHERE c.user_id = $1 ORDER BY c.provider`, [scope.userId]))
  ).rows.map(view);
}

/** After a successful callback: store (or update) the connection, tokens sealed. */
export async function saveConnection(scope: WorkspaceScope, provider: ProviderKey, t: TokenSet, who: Identity): Promise<void> {
  if (!scope.userId) throw new Error("A connection belongs to a signed-in person.");
  const key = getEnv().CONNECTIONS_KEY;
  const existing = await row(scope, provider);
  const scopes = [...new Set([...(existing?.scopes ?? []), ...t.scopes])];
  const refreshEnc = t.refreshToken ? seal(t.refreshToken, key) : existing?.refresh_token_enc ?? null;
  await withTenantSession(scope, (c) =>
    c.query(
      `INSERT INTO connections
         (tenant_id, user_id, provider, status, account_email, account_name, account_id, scopes,
          access_token_enc, refresh_token_enc, expires_at, last_error)
       VALUES ($1,$2,$3,'connected',$4,$5,$6,$7,$8,$9,$10,NULL)
       ON CONFLICT (tenant_id, user_id, provider) DO UPDATE SET
         status = 'connected', account_email = EXCLUDED.account_email, account_name = EXCLUDED.account_name,
         account_id = EXCLUDED.account_id, scopes = EXCLUDED.scopes, access_token_enc = EXCLUDED.access_token_enc,
         refresh_token_enc = EXCLUDED.refresh_token_enc, expires_at = EXCLUDED.expires_at, last_error = NULL`,
      [scope.tenantId, scope.userId, provider, who.email, who.name, who.id, scopes,
       seal(t.accessToken, key), refreshEnc, t.expiresAt],
    ),
  );
}

async function setStatus(scope: WorkspaceScope, id: string, status: Row["status"], error: string | null) {
  await withTenantSession(scope, (c) =>
    c.query(`UPDATE connections SET status = $1, last_error = $2 WHERE id = $3`, [status, error, id]),
  );
}

/**
 * A usable access token for this person's connection, refreshed when it is
 * about to expire. A refusal from the provider marks the connection expired,
 * so the page asks them to reconnect instead of failing on every click.
 */
export async function accessToken(
  scope: WorkspaceScope,
  provider: ProviderKey,
  fetchImpl?: FetchLike,
  now = Date.now(),
): Promise<{ token: string; connection: ConnectionView; accountId: string | null }> {
  const r = await row(scope, provider);
  if (!r) throw new ConnectionError("not_enabled", "Not connected yet.");
  const key = getEnv().CONNECTIONS_KEY;
  const fresh = !r.expires_at || r.expires_at.getTime() - now > 60_000;
  if (fresh) return { token: open(r.access_token_enc, key), connection: view(r), accountId: r.account_id };

  const client = clientFor(provider);
  if (!r.refresh_token_enc || !client) {
    await setStatus(scope, r.id, "expired", "The connection expired. Reconnect to carry on.");
    throw new ConnectionError("auth", "The connection expired.");
  }
  try {
    const t = await refresh(provider, client, { refreshToken: open(r.refresh_token_enc, key), scopes: r.scopes }, fetchImpl, now);
    await withTenantSession(scope, (c) =>
      c.query(
        `UPDATE connections SET access_token_enc = $1, refresh_token_enc = $2, expires_at = $3, status = 'connected', last_error = NULL WHERE id = $4`,
        [seal(t.accessToken, key), t.refreshToken ? seal(t.refreshToken, key) : r.refresh_token_enc, t.expiresAt, r.id],
      ),
    );
    return { token: t.accessToken, connection: view(r), accountId: r.account_id };
  } catch (e) {
    if (e instanceof ConnectionError && (e.kind === "auth" || e.kind === "revoked")) {
      await setStatus(scope, r.id, "expired", "Access was withdrawn. Reconnect to carry on.");
    }
    throw e;
  }
}

/** Remember how a capability's last run went, for the page. */
export async function recordSync(scope: WorkspaceScope, provider: ProviderKey, cap: CapabilityKey, s: { count: number; error?: string }) {
  const r = await row(scope, provider);
  if (!r) return;
  await withTenantSession(scope, (c) =>
    c.query(`UPDATE connections SET sync = sync || $1::jsonb WHERE id = $2`, [
      JSON.stringify({ [cap]: { at: new Date().toISOString(), count: s.count, ...(s.error ? { error: s.error } : {}) } }),
      r.id,
    ]),
  );
}

/** Imported writing into the person's corpus, linked to the connection. Returns how many were new. */
export async function addImported(
  scope: WorkspaceScope,
  pack: VoicePack,
  connectionId: string,
  pieces: ImportedPiece[],
): Promise<number> {
  return addSamples(
    scope,
    pack.id,
    pieces.map((p) => ({
      body: p.body,
      channel: p.channel,
      visibility: p.visibility,
      source: "connection" as const,
      publishedAt: p.publishedAt,
      connectionId,
      externalId: p.externalId,
      note: p.title ?? undefined,
    })),
  );
}

/**
 * Disconnect: revoke at the provider (best effort), then forget the tokens.
 * With `removeWriting`, everything that connection brought in goes too
 * ("removing a source deletes and rebuilds"); the caller re-measures.
 */
export async function disconnect(
  scope: WorkspaceScope,
  provider: ProviderKey,
  opts: { removeWriting: boolean },
  fetchImpl?: FetchLike,
): Promise<{ removed: number; revoked: boolean }> {
  const r = await row(scope, provider);
  if (!r) return { removed: 0, revoked: false };
  const client = clientFor(provider);
  const key = getEnv().CONNECTIONS_KEY;
  let revoked = false;
  if (client && key) {
    const token = r.refresh_token_enc ? open(r.refresh_token_enc, key) : open(r.access_token_enc, key);
    revoked = await revoke(provider, client, token, fetchImpl);
  }
  return withTenantSession(scope, async (c) => {
    const removed = opts.removeWriting
      ? (await c.query(`DELETE FROM voice_samples WHERE connection_id = $1`, [r.id])).rowCount ?? 0
      : 0;
    await c.query(`DELETE FROM connections WHERE id = $1`, [r.id]);
    return { removed, revoked };
  });
}
