/**
 * 6. The invite page is a real 404 for a link that isn't one of ours (it used
 * to answer 200 with an "Invite not found" page). An expired invite still
 * says so on its own page. The pillars redirect is covered with a real
 * workspace in tests/cross-tenant-endpoints.test.ts.
 */
import "dotenv/config";
import { describe, it, expect, vi } from "vitest";

vi.mock("next/headers", async () => (await import("./helpers/next-request")).nextHeaders);
vi.mock("next/cache", async () => (await import("./helpers/next-request")).nextCache);

import { randomUUID } from "node:crypto";
import InvitePage from "@/app/invite/[token]/page";
import { signLink } from "@/lib/auth/tokens";
import { dbReachable } from "./helpers/cross-tenant";

const render = (token: string) => InvitePage({ params: Promise.resolve({ token }) } as Parameters<typeof InvitePage>[0]);

async function outcome(token: string): Promise<"notFound" | "page" | string> {
  try {
    await render(token);
    return "page";
  } catch (e) {
    const digest = (e as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return "notFound";
    throw e;
  }
}

describe("invite page: 404, not a soft 404", () => {
  it("a link that isn't a token, or whose signature is forged, is notFound()", async () => {
    expect(await outcome("nonsense")).toBe("notFound");
    const [body] = signLink("invite", randomUUID(), "invited").split(".");
    expect(await outcome(`${body}.forgedsignature`)).toBe("notFound");
    // Another purpose's token (a sign-in link) is not an invite.
    expect(await outcome(signLink("signin", randomUUID(), ""))).toBe("notFound");
  });

  it("an expired invite keeps its own page, which says to ask for a new one", async () => {
    const old = signLink("invite", randomUUID(), "invited", Date.now() - 30 * 864e5);
    expect(await outcome(old)).toBe("page");
  });

  it("a signed invite for an account that doesn't exist is notFound()", async () => {
    if (!(await dbReachable())) return;
    expect(await outcome(signLink("invite", randomUUID(), "invited"))).toBe("notFound");
  });
});
