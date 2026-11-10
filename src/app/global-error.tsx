"use client";

import { useEffect } from "react";
import { sendClientError } from "@/lib/observability/client-send";

/**
 * The last-resort error page, for a failure in the root layout itself (the
 * app's error.tsx can't catch those). It replaces the whole document, so it
 * carries its own minimal styles: monochrome, light or dark with the system.
 * A failure in the browser is sent to the server log; one on the server is
 * there already (instrumentation onRequestError).
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    sendClientError(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <title>Something went wrong</title>
        <style>{`
          :root { color-scheme: light dark; --bg: #fff; --ink: #0a0a0a; --muted: #6b6b6b; }
          @media (prefers-color-scheme: dark) { :root { --bg: #0a0a0a; --ink: #f5f5f5; --muted: #9a9a9a; } }
          body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--ink);
                 font-family: system-ui, -apple-system, "Segoe UI", sans-serif; padding: 24px; }
          main { max-width: 360px; text-align: center; }
          h1 { font-size: 24px; font-weight: 500; margin: 0 0 8px; }
          p { color: var(--muted); font-size: 14px; line-height: 1.5; margin: 0 0 24px; }
          button { min-height: 44px; padding: 0 24px; border-radius: 999px; border: 0; background: var(--ink); color: var(--bg); font-size: 14px; cursor: pointer; }
          small { display: block; margin-top: 16px; color: var(--muted); }
        `}</style>
        <main>
          <h1>That didn&apos;t load</h1>
          <p>Something went wrong on our side. Your work is saved; trying again usually fixes it.</p>
          <button type="button" onClick={() => retry()}>Try again</button>
          {error.digest && <small>Reference {error.digest}. Quote it if you contact support.</small>}
        </main>
      </body>
    </html>
  );
}
