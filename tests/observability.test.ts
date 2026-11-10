/**
 * Structured logging and error reporting (lib/observability):
 * - info and debug go to stdout, warn and error to stderr (hosts count stderr as errors);
 * - secrets, cookies, tokens, signed links, email bodies and brand content never reach a line;
 * - reportError makes no network call without SENTRY_DSN, and with one posts a
 *   well-formed Sentry envelope (checked by a fake Sentry server in this process);
 * - it never throws, even when Sentry is down or slow;
 * - browser reports are capped per person and turned into a clean Error.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { formatLine, isSensitiveKey, logger, scrub } from "@/lib/observability/log";
import { buildEvent, parseDsn, reportError, stackFrames } from "@/lib/observability/report";
import { allowReport, clientErrorFrom } from "@/lib/observability/client-report";
import { parseEnv } from "@/lib/env";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const o = vi.spyOn(process.stdout, "write").mockImplementation((c: string | Uint8Array) => (out.push(String(c)), true));
  const e = vi.spyOn(process.stderr, "write").mockImplementation((c: string | Uint8Array) => (err.push(String(c)), true));
  return { out, err, restore: () => (o.mockRestore(), e.mockRestore()) };
}

afterEach(() => vi.restoreAllMocks());

describe("structured logger", () => {
  it("writes one JSON line per entry, info and debug to stdout, warn and error to stderr", () => {
    const c = capture();
    try {
      logger.debug("debug line", { tenantId: "t-1" });
      logger.info("info line", { tenantId: "t-1", userId: "u-1", route: "/w/[id]", requestId: "r-1", count: 3 });
      logger.warn("warn line");
      logger.error("error line", { err: new Error("boom") });
    } finally {
      c.restore();
    }
    expect(c.out).toHaveLength(2);
    expect(c.err).toHaveLength(2);
    const info = JSON.parse(c.out[1]);
    expect(info).toMatchObject({ level: "info", msg: "info line", tenantId: "t-1", userId: "u-1", route: "/w/[id]", requestId: "r-1", count: 3 });
    expect(new Date(info.time).toString()).not.toBe("Invalid Date");
    expect(c.out.every((l) => l.endsWith("\n") && !l.slice(0, -1).includes("\n"))).toBe(true);
    expect(JSON.parse(c.err[0]).level).toBe("warn");
    const error = JSON.parse(c.err[1]);
    expect(error.level).toBe("error");
    expect(error.err).toMatchObject({ name: "Error", message: "boom" });
    expect(error.err.stack).toContain("observability.test.ts");
  });

  it("adds a child logger's fields to every line", () => {
    const c = capture();
    try {
      logger.child({ tenantId: "t-9", route: "/cron" }).info("swept", { removed: 2 });
    } finally {
      c.restore();
    }
    expect(JSON.parse(c.out[0])).toMatchObject({ tenantId: "t-9", route: "/cron", removed: 2 });
  });

  it("redacts sensitive fields at any depth, and content fields", () => {
    const line = JSON.parse(formatLine("info", "x", {
      password: "hunter2",
      apiKey: "sk-live-123",
      "x-api-key": "k",
      resetToken: "t",
      cookie: "huemen_session=abc",
      headers: { cookie: "c", authorization: "Bearer zzz" },
      nested: { deeper: { secret: "s", sessionToken: "st", ok: "fine" } },
      body: "Dear Sahil, here is my whole brand story",
      html: "<p>email body</p>",
      brand: { positioning: "secret sauce" },
      prompt: "write a post about my divorce",
      context: "kept", // not "text"
      invoice: "kept", // not "voice"
      storageKey: "tenants/t/assets/a.png",
      tokens: 120,
    }));
    for (const k of ["password", "apiKey", "x-api-key", "resetToken", "cookie", "headers", "body", "html", "brand", "prompt"]) expect(line[k]).toBe("[redacted]");
    expect(line.nested.deeper).toEqual({ secret: "[redacted]", sessionToken: "[redacted]", ok: "fine" });
    expect([line.context, line.invoice, line.storageKey, line.tokens]).toEqual(["kept", "kept", "tenants/t/assets/a.png", 120]);
    const raw = formatLine("info", "x", { a: { b: { password: "hunter2" } }, list: [{ token: "abc" }] });
    expect(raw).not.toContain("hunter2");
    expect(raw).not.toContain('"abc"');
  });

  it("scrubs secrets out of strings: URL credentials, bearer tokens, signed links, email addresses", () => {
    const s = scrub(
      "connect postgres://huemen_app:s3cr3t@db:5432/x failed; Authorization: Bearer eyJhbGci.abc.def; " +
      "GET /api/storage/tenants/t/a.png?token=123.abcdef&x=1 and /invite?code=zzz; mail to sahil@example.com",
    );
    expect(s).not.toContain("s3cr3t");
    expect(s).not.toContain("eyJhbGci");
    expect(s).not.toContain("123.abcdef");
    expect(s).not.toContain("zzz");
    expect(s).not.toContain("sahil@");
    expect(s).toContain("postgres://[redacted]@db:5432/x");
    expect(s).toContain("token=[redacted]&x=1");
    expect(s).toContain("s***@example.com");
    // and in an error's message and stack
    const line = JSON.parse(formatLine("error", "failed for bob@corp.io", { err: new Error("bad key ?key=AKIA123 for bob@corp.io") }));
    expect(JSON.stringify(line)).not.toMatch(/AKIA123|bob@corp/);
  });

  it("knows which names are sensitive", () => {
    expect(["password", "DB_PASSWORD", "set-cookie", "clientSecret", "SENTRY_DSN", "access_token", "authorization"].every(isSensitiveKey)).toBe(true);
    expect(["tenantId", "userId", "route", "count", "status", "contextVersion", "invoiceId"].some(isSensitiveKey)).toBe(false);
  });

  it("never throws, whatever it is given", () => {
    const c = capture();
    try {
      const loop: Record<string, unknown> = {};
      loop.self = loop;
      expect(() => logger.info("cyclic", { loop, big: BigInt(10), fn: () => 1, sym: Symbol("s") })).not.toThrow();
    } finally {
      c.restore();
    }
    expect(JSON.parse(c.out[0]).msg).toBe("cyclic");
  });
});

describe("Sentry settings", () => {
  const BASE = { DATABASE_URL: "postgres://x", DATABASE_ADMIN_URL: "postgres://x", DATABASE_APP_PASSWORD: "x", AUTH_SECRET: "0123456789abcdef0123" };
  it("are optional, and a blank DSN means none", () => {
    expect(parseEnv(BASE).SENTRY_DSN).toBeUndefined();
    expect(parseEnv({ ...BASE, SENTRY_DSN: "" }).SENTRY_DSN).toBeUndefined();
    expect(() => parseEnv({ ...BASE, SENTRY_DSN: "not a url" })).toThrow(/SENTRY_DSN/);
  });

  it("parse a DSN into the envelope address and public key", () => {
    expect(parseDsn("https://abc123@o42.ingest.sentry.io/4500")).toEqual({ url: "https://o42.ingest.sentry.io/api/4500/envelope/", publicKey: "abc123" });
    expect(parseDsn("http://k@127.0.0.1:9000/sentry/7")).toEqual({ url: "http://127.0.0.1:9000/sentry/api/7/envelope/", publicKey: "k" });
    expect(parseDsn("https://o42.ingest.sentry.io/4500")).toBeNull(); // no key
    expect(parseDsn("nonsense")).toBeNull();
  });
});

describe("reportError", () => {
  let server: Server;
  let base = "";
  const received: { url: string; headers: Record<string, string | string[] | undefined>; body: string }[] = [];
  let mode: "ok" | "fail" | "hang" = "ok";

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        received.push({ url: req.url!, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
        if (mode === "hang") return; // never answers
        res.writeHead(mode === "ok" ? 200 : 500, { "Content-Type": "application/json" }).end(mode === "ok" ? '{"id":"x"}' : "{}");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));

  it("logs the error and makes no network call without a DSN", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const c = capture();
    try {
      await reportError(new Error("no dsn here"), { route: "/w/[id]" }); // configured env: .env has no SENTRY_DSN
      await reportError(new Error("explicitly none"), {}, { dsn: null });
    } finally {
      c.restore();
      vi.unstubAllGlobals();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(c.err.map((l) => JSON.parse(l).msg)).toEqual(["no dsn here", "explicitly none"]);
    expect(JSON.parse(c.err[0])).toMatchObject({ level: "error", route: "/w/[id]" });
  });

  it("posts a well-formed envelope to Sentry when a DSN is set", async () => {
    received.length = 0;
    mode = "ok";
    const dsn = `http://publickey123@${base}/9001`;
    const err = new TypeError("cannot read brand of undefined, see /api/storage/x.png?token=abc.def");
    const c = capture();
    try {
      await reportError(err, {
        tenantId: "11111111-1111-1111-1111-111111111111", userId: "u-1", route: "/w/[id]/brand", source: "action",
        method: "POST", path: "/w/111/brand?token=secret", requestId: "req-1", digest: "12345",
      }, { dsn, environment: "test-env" });
    } finally {
      c.restore();
    }
    expect(received).toHaveLength(1);
    const r = received[0];
    expect(r.url).toBe("/api/9001/envelope/");
    expect(r.headers["content-type"]).toBe("application/x-sentry-envelope");
    expect(r.headers["x-sentry-auth"]).toMatch(/^Sentry sentry_version=7, sentry_key=publickey123, sentry_client=huemen-studio\/1\.0$/);

    const lines = r.body.trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    const [head, item, payload] = lines;
    const header = JSON.parse(head);
    const event = JSON.parse(payload);
    expect(header).toMatchObject({ event_id: event.event_id, dsn });
    expect(header.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(new Date(header.sent_at).toString()).not.toBe("Invalid Date");
    expect(JSON.parse(item)).toEqual({ type: "event", content_type: "application/json", length: Buffer.byteLength(payload) });

    expect(event).toMatchObject({ platform: "node", level: "error", environment: "test-env", user: { id: "u-1" } });
    expect(typeof event.timestamp).toBe("number");
    expect(event.exception.values[0]).toMatchObject({ type: "TypeError" });
    expect(event.exception.values[0].value).toContain("token=[redacted]");
    expect(event.exception.values[0].stacktrace.frames.length).toBeGreaterThan(0);
    expect(event.exception.values[0].stacktrace.frames.at(-1).filename).toContain("observability.test.ts"); // newest frame last
    expect(event.tags).toMatchObject({ source: "action", route: "/w/[id]/brand", tenant_id: "11111111-1111-1111-1111-111111111111", digest: "12345" });
    expect(event.request).toEqual({ method: "POST", url: "/w/111/brand" }); // no query string
    expect(event.extra).toEqual({ requestId: "req-1" });
    expect(r.body).not.toContain("secret");
    expect(r.body).not.toContain("abc.def");

    // and it was logged too
    expect(JSON.parse(c.err[0])).toMatchObject({ level: "error", tenantId: "11111111-1111-1111-1111-111111111111", digest: "12345" });
  });

  it("reports the same error object once, however many layers catch it", async () => {
    received.length = 0;
    const err = new Error("twice");
    const c = capture();
    try {
      await reportError(err, {}, { dsn: `http://k@${base}/1` });
      await reportError(err, {}, { dsn: `http://k@${base}/1` });
    } finally {
      c.restore();
    }
    expect(received).toHaveLength(1);
  });

  it("never throws when Sentry refuses, is down, or hangs, and gives up quickly", async () => {
    const c = capture();
    try {
      mode = "fail";
      await expect(reportError(new Error("refused"), {}, { dsn: `http://k@${base}/1` })).resolves.toBeUndefined();
      await expect(reportError(new Error("down"), {}, { dsn: "http://k@127.0.0.1:1/1" })).resolves.toBeUndefined();
      mode = "hang";
      const t0 = Date.now();
      await expect(reportError(new Error("slow"), {}, { dsn: `http://k@${base}/1`, timeoutMs: 200 })).resolves.toBeUndefined();
      expect(Date.now() - t0).toBeLessThan(2000);
      await expect(reportError(new Error("bad dsn"), {}, { dsn: "https://no-key.example/1" })).resolves.toBeUndefined();
      await expect(reportError("a string", {}, { dsn: null })).resolves.toBeUndefined();
    } finally {
      c.restore();
      mode = "ok";
    }
    const warnings = c.err.map((l) => JSON.parse(l)).filter((l) => l.level === "warn").map((l) => l.msg);
    expect(warnings).toEqual(["error report not accepted", "error report not sent", "error report not sent", "error report not sent: SENTRY_DSN is not a valid DSN"]);
  });

  it("builds frames oldest first and marks library code as not the app's", () => {
    const frames = stackFrames("Error: x\n    at inner (/app/src/lib/a.ts:10:5)\n    at Object.run (/app/node_modules/pg/lib/client.js:1:2)\n    at node:internal/process/task_queues:95:5");
    expect(frames.map((f) => [f.filename, f.in_app])).toEqual([
      ["node:internal/process/task_queues", false],
      ["/app/node_modules/pg/lib/client.js", false],
      ["/app/src/lib/a.ts", true],
    ]);
    const ev = buildEvent("plain string", {}, { environment: "e", eventId: "0".repeat(32), now: new Date(0) });
    expect(ev.exception.values[0].value).toBe("plain string");
  });
});

describe("browser error reports", () => {
  it("are capped per person per minute", () => {
    const now = 1_000_000;
    const who = `u-${Math.random()}`;
    const results = Array.from({ length: 12 }, () => allowReport(who, now));
    expect(results.filter(Boolean)).toHaveLength(10);
    expect(allowReport(`other-${Math.random()}`, now)).toBe(true);
    expect(allowReport(who, now + 61_000)).toBe(true);
  });

  it("become a clean Error; ones with a digest (server errors) are not reported twice", () => {
    const r = clientErrorFrom({ name: "TypeError<script>", message: "x is undefined", stack: "TypeError: x\n    at Foo (https://app/_next/static/chunks/a.js:1:2)\nnot a frame", path: "/w/1/brand?token=abc" });
    expect(r?.error.name).toBe("TypeErrorscript");
    expect(r?.error.stack).toBe("TypeErrorscript: x is undefined\n    at Foo (https://app/_next/static/chunks/a.js:1:2)");
    expect(r?.path).toBe("/w/1/brand");
    expect(clientErrorFrom({ message: "server", digest: "123" })).toBeNull();
    expect(clientErrorFrom("nope")).toBeNull();
    expect(clientErrorFrom([1])).toBeNull();
    expect(clientErrorFrom({ message: "m".repeat(10_000) })?.error.message).toHaveLength(500);
  });
});
