/**
 * When the Getting started window is open on Home. Pure, client-safe.
 *
 * It used to open again after the person closed it, later in the same
 * session: the page opened it whenever the URL still said `?ready=1` (Back to
 * Home after onboarding), and a page the router had cached from before the
 * close still said "open". Now:
 *   - the server opens it only while the pack has no guideSeenAt (guideOpensItself);
 *   - a close is also kept in this tab (sessionStorage), so a cached page
 *     can't open it again before the server's answer is fresh;
 *   - "Open the guide" always opens it.
 */
export type GuideOpen = "auto" | "open" | "closed";

export const guideClosedKey = (tenantId: string) => `huemen:guide-closed:${tenantId}`;

/** The server's call: open by itself only until it has been seen once. */
export const guideOpensItself = (guideSeenAt: string | null | undefined): boolean => !guideSeenAt;

/** The client's call: an auto-open is cancelled by a close kept in this tab; a person's own open is not. */
export const shouldShowGuide = (state: GuideOpen, closedInThisTab: boolean): boolean =>
  state === "open" || (state === "auto" && !closedInThisTab);
