/**
 * Prompt template store (brief §05, TASKS P2-2). Templates are DATA: resolved by
 * key with a per-tenant override winning over the global row, highest active
 * version first. The resolved id + version are stamped on content for tracing.
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession, type SessionScope } from "@/db/session";
import { TASKS } from "./tasks";

export interface ResolvedTemplate {
  id: string | null;
  key: string;
  version: number;
  body: string;
}

/** Fallback when no row exists yet — visible in the stamped id (null). */
const FALLBACK: Record<string, string> = {
  pillar_set: "You are a personal-brand strategist. From the brand context and the strategy answers, propose 3-5 distinct content pillars. Output one per line as: Name :: one-line description. No other text.",
  newsletter_section: "You write a newsletter section in the brand voice.",
  pitch_email: "You write a short, specific pitch email in the brand voice.",
  talk_abstract: "You write a conference talk abstract in the brand voice.",
  ig_carousel: "You write Instagram carousel copy, one line per slide.",
  x_post: "You write one X post in the person's voice: one idea, within the character limit. If the idea needs more room, write a short thread with each part numbered 1/, 2/ and every part within the limit.",
  threads_post: "You write one Threads post in the person's voice: conversational, lighter than LinkedIn, within the character limit.",
  linkedin_comment: "You write a LinkedIn comment in the person's voice: one thought that responds to the post rather than restating it.",
  whatsapp_message: "You write a WhatsApp message in the person's voice. Use only *bold*, _italic_ and ~strike~ formatting, never markdown headers.",
  slack_message: "You write a Slack or Teams message in the person's voice: short, using Slack formatting only.",
  bio: "You write a bio or About section in the person's voice. Lead with what they want to be known for. Never invent a credential.",
};

export async function resolveTemplate(scope: SessionScope, key: string): Promise<ResolvedTemplate> {
  const row = (
    await withTenantSession(scope, (c) =>
      c.query<{ id: string; version: number; body: string }>(
        `SELECT id, version, body FROM prompt_templates
          WHERE key = $1 AND is_active
          ORDER BY (tenant_id IS NOT NULL) DESC, version DESC LIMIT 1`,
        [key],
      ),
    )
  ).rows[0];
  if (row) return { id: row.id, key, version: row.version, body: row.body };
  return {
    id: null,
    key,
    version: 0,
    body: FALLBACK[key] ?? TASKS[key]?.template ?? "You write on-brand content.",
  };
}
