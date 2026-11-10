/**
 * The only things an agent answer's buttons can do. Pure, so the panel and the
 * server action read the same allow-list; the server re-validates whatever the
 * browser sends, so a tampered or invented action is refused, never run.
 */
import { z } from "zod";
import { FORMATS } from "@/lib/content/formats";
import { PAGE_KEYS, type AgentAction } from "./spec";

const text = (max: number) => z.string().trim().min(1).max(max);

const schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ask"), params: z.object({ text: text(500) }) }),
  z.object({ type: z.literal("open"), params: z.object({ page: z.enum(PAGE_KEYS) }) }),
  z.object({
    type: z.literal("draft_piece"),
    params: z.object({
      format: z.enum(FORMATS.map((f) => f.key) as [string, ...string[]]),
      topic: text(400),
      pillar: z.string().trim().max(120).optional().nullable().transform((v) => v || undefined),
    }),
  }),
  z.object({
    type: z.literal("add_pillar"),
    params: z.object({ name: text(80), description: z.string().trim().max(300).optional().nullable().transform((v) => v || undefined) }),
  }),
  z.object({ type: z.literal("capture_idea"), params: z.object({ text: text(500) }) }),
]);

export function parseAgentAction(input: unknown): AgentAction | null {
  const r = schema.safeParse(input);
  return r.success ? (r.data as AgentAction) : null;
}
