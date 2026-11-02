/**
 * Production sign-in email: the settings that must go together, the message
 * itself, and the Resend call (with a fake fetch, never the real service).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseEnv } from "@/lib/env";

const BASE = { DATABASE_URL: "postgres://x", DATABASE_ADMIN_URL: "postgres://x", DATABASE_APP_PASSWORD: "x", AUTH_SECRET: "0123456789abcdef0123" };

describe("sign-in settings", () => {
  it("accepts the old AUTH_DRIVER=managed as email sign-in", () => {
    expect(parseEnv({ ...BASE, AUTH_DRIVER: "managed", MAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test", MAIL_FROM: "Huemen <a@b.co>" }).AUTH_DRIVER).toBe("email");
  });
  it("refuses email sign-in with no way to send the email", () => {
    expect(() => parseEnv({ ...BASE, AUTH_DRIVER: "email" })).toThrow(/MAIL_PROVIDER=resend/);
  });
  it("refuses Resend without a key or a sender", () => {
    expect(() => parseEnv({ ...BASE, MAIL_PROVIDER: "resend" })).toThrow(/RESEND_API_KEY[\s\S]*MAIL_FROM/);
  });
  it("keeps local development as it was: dev sign-in, mail to the log", () => {
    const env = parseEnv(BASE);
    expect([env.AUTH_DRIVER, env.MAIL_PROVIDER]).toEqual(["dev", "log"]);
  });
});

const env = { MAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test_key", MAIL_FROM: "Huemen.studio <studio@example.com>" };
vi.mock("@/lib/env", async (orig) => ({ ...(await orig<typeof import("@/lib/env")>()), getEnv: () => env }));
const { renderAuthMail, sendAuthMail, MailError } = await import("@/lib/mail");

const MAIL = { to: "priya@example.com", subject: "Your sign-in link", link: "https://app.example/auth/verify?token=a.b&next=%2Fw", lines: ["Sign in to <Priya's> studio."], action: "Sign in" };

describe("the message", () => {
  it("escapes everything that goes into the HTML", () => {
    const { html, text } = renderAuthMail(MAIL);
    expect(html).toContain("Sign in to &lt;Priya&#39;s&gt; studio.");
    expect(html).toContain('href="https://app.example/auth/verify?token=a.b&amp;next=%2Fw"');
    expect(html).not.toContain("<Priya");
    expect(text).toContain("Sign in: https://app.example/auth/verify?token=a.b&next=%2Fw");
  });
  it("names no one but Huemen.studio", () => {
    expect(renderAuthMail(MAIL).html).not.toMatch(/okra/i);
  });
});

describe("sending through Resend", () => {
  beforeEach(() => { env.MAIL_PROVIDER = "resend"; });

  it("posts the message with the key, the sender and both bodies", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
    expect(await sendAuthMail(MAIL, fetchImpl)).toEqual({ delivered: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ from: "Huemen.studio <studio@example.com>", to: ["priya@example.com"], subject: "Your sign-in link" });
    expect(body.text).toContain("Sign in:");
    expect(body.html).toContain("<a href=");
  });
  it("turns a refusal into a plain message, never the provider's error", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => new Response('{"message":"domain not verified"}', { status: 403 }));
    await expect(sendAuthMail(MAIL, fetchImpl)).rejects.toThrow(MailError);
    await expect(sendAuthMail(MAIL, fetchImpl)).rejects.toThrow(/couldn't send the email/);
    err.mockRestore();
  });
  it("treats a network failure the same way", async () => {
    await expect(sendAuthMail(MAIL, vi.fn(async () => { throw new TypeError("fetch failed"); }))).rejects.toThrow(/didn't answer/);
  });
  it("writes to the log instead when MAIL_PROVIDER=log", async () => {
    env.MAIL_PROVIDER = "log";
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const fetchImpl = vi.fn();
    expect(await sendAuthMail(MAIL, fetchImpl)).toEqual({ delivered: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    info.mockRestore();
  });
});
