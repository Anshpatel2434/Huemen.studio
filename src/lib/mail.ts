/**
 * Outbound auth email (sign-in links, invites). The dev driver writes the
 * message to the server log, and the pages show a "dev inbox" link, so the
 * whole flow can be clicked through locally. In production the managed auth
 * provider sends these (brief §05); wire its API here, not in the pages.
 *
 * Server-only.
 */
import "server-only";
import { getEnv } from "@/lib/env";

export interface AuthMail {
  to: string;
  subject: string;
  link: string;
  lines: string[];
}

export async function sendAuthMail(m: AuthMail): Promise<{ delivered: boolean }> {
  if (getEnv().AUTH_DRIVER === "dev") {
    console.info(`[mail:dev] to=${m.to} subject="${m.subject}"\n  ${m.lines.join("\n  ")}\n  ${m.link}`);
    return { delivered: false };
  }
  // Managed provider sends its own sign-in and invite mail.
  return { delivered: true };
}
