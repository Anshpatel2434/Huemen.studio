/**
 * Operations logging (brief §05). The thing worth pinning is not that a line
 * is printed — it is that the line is machine-readable in production, that an
 * error carries enough to find it, and that it never carries content.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const ORIGINAL = { ...process.env };

/**
 * `log` reads the env through the module-level cache in env.ts, so each case
 * re-imports both with a fresh registry rather than trying to mutate it.
 */
async function withEnv(vars: Record<string, string>, run: (log: typeof import("@/lib/log")) => Promise<void> | void) {
  vi.resetModules();
  Object.assign(process.env, {
    DATABASE_URL: "postgres://x",
    DATABASE_ADMIN_URL: "postgres://x",
    DATABASE_APP_PASSWORD: "x",
    AUTH_SECRET: "0123456789abcdef0123",
    ...vars,
  });
  await run(await import("@/lib/log"));
}

afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in ORIGINAL)) delete process.env[k];
  Object.assign(process.env, ORIGINAL);
  vi.restoreAllMocks();
});

describe("structured logging", () => {
  it("emits one JSON line per event in production", async () => {
    await withEnv({ NODE_ENV: "production", LOG_LEVEL: "info" }, ({ log }) => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      log.info("ai.text", { tenantId: "t1", provider: "openai", ms: 42 });
      expect(spy).toHaveBeenCalledTimes(1);
      const line = JSON.parse(spy.mock.calls[0][0] as string);
      expect(line).toMatchObject({ level: "info", event: "ai.text", tenantId: "t1", provider: "openai", ms: 42 });
      expect(typeof line.time).toBe("string");
    });
  });

  it("stays readable outside production", async () => {
    await withEnv({ NODE_ENV: "development", LOG_LEVEL: "info" }, ({ log }) => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      log.info("ai.text", { tenantId: "t1" });
      const line = spy.mock.calls[0][0] as string;
      expect(line).toContain("[info] ai.text");
      expect(line).toContain("tenantId=t1");
      expect(() => JSON.parse(line)).toThrow();
    });
  });

  it("drops anything below LOG_LEVEL", async () => {
    await withEnv({ NODE_ENV: "development", LOG_LEVEL: "warn" }, ({ log }) => {
      const info = vi.spyOn(console, "log").mockImplementation(() => {});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      log.info("ignored.event");
      log.warn("kept.event");
      expect(info).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  it("records an error's name and message, and keeps the stack out of production", async () => {
    await withEnv({ NODE_ENV: "production", LOG_LEVEL: "info" }, ({ log }) => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      log.error("mail.send", new TypeError("upstream refused"), { provider: "resend" });
      const line = JSON.parse(spy.mock.calls[0][0] as string);
      expect(line).toMatchObject({ level: "error", event: "mail.send", errorName: "TypeError", errorMessage: "upstream refused", provider: "resend" });
      expect(line.stack).toBeUndefined();
    });
  });

  it("keeps the stack in development, where someone is reading it", async () => {
    await withEnv({ NODE_ENV: "development", LOG_LEVEL: "debug" }, ({ log }) => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      log.error("mail.send", new Error("boom"));
      expect(spy.mock.calls[0][0] as string).toContain("stack=");
    });
  });

  // A provider's error message is not ours and can be arbitrarily long; a log
  // line that carries a whole response body is how a draft ends up in a log.
  it("caps an error message", async () => {
    await withEnv({ NODE_ENV: "production", LOG_LEVEL: "info" }, ({ log }) => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      log.error("ai.text", new Error("x".repeat(5000)));
      expect(JSON.parse(spy.mock.calls[0][0] as string).errorMessage.length).toBe(500);
    });
  });
});

describe("error reporting", () => {
  it("logs and posts to the webhook when one is configured", async () => {
    await withEnv({ NODE_ENV: "production", ERROR_WEBHOOK_URL: "https://errors.example.com/hook" }, async ({ reportError }) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
      await reportError("ai.text", new Error("boom"), { tenantId: "t1" });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://errors.example.com/hook");
      expect(JSON.parse(String(init?.body))).toMatchObject({ event: "ai.text", tenantId: "t1", errorMessage: "boom" });
    });
  });

  it("logs only when no webhook is configured", async () => {
    await withEnv({ NODE_ENV: "production" }, async ({ reportError }) => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
      await reportError("ai.text", new Error("boom"));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // The whole point is to report a failure. If reporting is itself the thing
  // that throws, the caller must not inherit a second, worse error.
  it("never throws when the webhook is down", async () => {
    await withEnv({ NODE_ENV: "production", ERROR_WEBHOOK_URL: "https://errors.example.com/hook" }, async ({ reportError }) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
      await expect(reportError("ai.text", new Error("boom"))).resolves.toBeUndefined();
    });
  });
});
