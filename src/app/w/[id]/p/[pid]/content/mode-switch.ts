import type { WorkMode } from "@/lib/voice/types";

/**
 * What the composer keeps when the person switches how a piece gets written.
 *
 * Drafting modes ("Draft it for me", "Write it together") use the topic box;
 * "I'll write it" uses the piece box. Switching used to show the other box
 * empty, so what was typed looked gone. Now:
 *   - into "I'll write it" with an empty piece box, the topic carries in as a start;
 *   - back to a drafting mode with an empty topic box, the first line of the
 *     piece carries back as the topic.
 * Nothing typed is ever thrown away: both boxes keep their own text.
 */
export function carryOnModeSwitch(
  from: WorkMode,
  to: WorkMode,
  boxes: { brief: string; text: string },
): { brief: string; text: string } {
  const { brief, text } = boxes;
  if (from === to) return { brief, text };
  if (to === "check" && from !== "check") {
    return { brief, text: text.trim() ? text : brief.trim() ? brief : text };
  }
  if (from === "check" && to !== "check") {
    const firstLine = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
    return { brief: brief.trim() ? brief : firstLine, text };
  }
  return { brief, text };
}
