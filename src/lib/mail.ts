/**
 * Outbound auth email: one-time sign-in links and invites.
 *
 * MAIL_PROVIDER=log writes the message to the server log (and in AUTH_DRIVER=dev
 * the pages show a "dev inbox" link), so the flow can be clicked through
 * locally. MAIL_PROVIDER=resend sends it through Resend's HTTP API from
 * MAIL_FROM, a sender on a domain verified with Resend. Pages call
 * sendAuthMail and never talk to a provider themselves.
 *
 * Server-only.
 */
import "server-only";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/observability/log";

export interface AuthMail {
  to: string;
  subject: string;
  link: string;
  /** Short lines above the button, plain text. */
  lines: string[];
  /** The button's words. */
  action?: string;
}

export class MailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailError";
  }
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The message as plain text and as a small, client-safe HTML page (no tracking, no images). */
export function renderAuthMail(m: AuthMail): { text: string; html: string } {
  const action = m.action ?? "Open Huemen.studio";
  const text = [...m.lines, "", `${action}: ${m.link}`, "", "If you didn't ask for this, you can ignore this email."].join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f4f4f2;font-family:Helvetica,Arial,sans-serif;color:#0b0b0b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px">
<tr><td style="font-size:15px;font-weight:600;padding-bottom:20px">Huemen.studio</td></tr>
${m.lines.map((l) => `<tr><td style="font-size:16px;line-height:1.55;padding-bottom:10px">${escape(l)}</td></tr>`).join("\n")}
<tr><td style="padding:18px 0 22px"><a href="${escape(m.link)}" style="display:inline-block;background:#0b0b0b;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 26px;border-radius:999px">${escape(action)}</a></td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:#5d6168">If the button doesn't work, copy this address into your browser:<br><span style="word-break:break-all">${escape(m.link)}</span></td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:#5d6168;padding-top:18px">If you didn't ask for this, you can ignore this email.</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function sendAuthMail(m: AuthMail, fetchImpl: FetchLike = fetch): Promise<{ delivered: boolean }> {
  const env = getEnv();
  if (env.MAIL_PROVIDER === "log") {
    // Plain text on purpose, not the structured logger: printing the link is
    // this mode's whole job (local work only; email sign-in refuses it).
    console.info(`[mail:log] to=${m.to} subject="${m.subject}"\n  ${m.lines.join("\n  ")}\n  ${m.link}`);
    return { delivered: false };
  }

  const { text, html } = renderAuthMail(m);
  let res: Response;
  try {
    res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [m.to], subject: m.subject, text, html }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new MailError("The email service didn't answer. Try again in a minute.");
  }
  if (!res.ok) {
    // The provider's reason goes to the log; the person gets a plain message.
    logger.error("email not sent", { provider: "resend", status: res.status, reason: (await res.text().catch(() => "")).slice(0, 300) });
    throw new MailError("We couldn't send the email just now. Try again in a minute.");
  }
  return { delivered: true };
}
