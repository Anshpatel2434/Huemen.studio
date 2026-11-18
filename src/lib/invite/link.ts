/**
 * The base URL of a workspace's links (invite, questionnaire): the
 * workspace's own host when it has one (tenants.custom_domain), else the app
 * URL. Pure.
 *
 * Invite links used to be built on APP_URL (http://localhost:3120) for every
 * workspace, so a client whose workspace lives on its own host
 * ("new-client.localhost:3120" in development, its domain in production) was
 * signed in on the wrong host and landed signed out on their own.
 *
 * A host is accepted only as a bare host name with an optional port (no path,
 * no credentials, nothing else): anything else falls back to the app URL.
 * Local hosts (localhost, *.localhost) keep the app URL's scheme and, when
 * they name none, its port; every other host is https.
 */
const HOST = /^(?=.{1,253}(?::\d{1,5})?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/;

export function workspaceBaseUrl(appUrl: string, customDomain: string | null | undefined): string {
  const app = appUrl.replace(/\/+$/, "");
  const raw = (customDomain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!raw || !HOST.test(raw)) return app;
  const [name, port] = raw.split(":");
  if (port && (Number(port) < 1 || Number(port) > 65535)) return app;
  const local = name === "localhost" || name.endsWith(".localhost");
  if (!local) return `https://${raw}`;
  let appParsed: URL | null = null;
  try { appParsed = new URL(app); } catch { /* not a URL: plain http below */ }
  const scheme = appParsed?.protocol === "https:" ? "https" : "http";
  const appPort = appParsed?.port;
  return `${scheme}://${name}${port ? `:${port}` : appPort ? `:${appPort}` : ""}`;
}

/** The accept-invite link for a signed invite token, on the workspace's host. */
export const inviteLink = (appUrl: string, customDomain: string | null | undefined, token: string): string =>
  `${workspaceBaseUrl(appUrl, customDomain)}/invite/${token}`;
