/**
 * Browser side of error reports, for the error boundaries. Sends a browser
 * error to /api/client-error once; an error with a digest came from the server
 * and was reported there already, so it is not sent again. Best effort: it
 * never throws and nobody waits for it.
 */
const sent = new WeakSet<Error>();

export function sendClientError(error: Error & { digest?: string }): void {
  try {
    if (error.digest || sent.has(error) || typeof window === "undefined") return;
    sent.add(error);
    const body = JSON.stringify({
      name: error.name,
      message: String(error.message ?? "").slice(0, 500),
      stack: String(error.stack ?? "").slice(0, 4000),
      // The path only: a query string can carry a token.
      path: window.location.pathname,
    });
    void fetch("/api/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    // Reporting must never break the error page itself.
  }
}
