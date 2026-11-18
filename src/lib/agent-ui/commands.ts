/**
 * The agent panel's named commands: "Idea: ..." and "Add pillar ...". They say
 * what they are, so they are read BEFORE a message is taken as an edit of the
 * open piece (2026-11-18: "Idea: the Monday meeting cost us 15 hours a week
 * before I cut it" was read as "cut" the open piece, and the piece was
 * rewritten). Pure, so the order is testable without a database.
 */
export type NamedCommand = { type: "idea"; text: string } | { type: "pillar"; name: string };

const IDEA = /^(?:idea|note|capture)\s*[:\-]\s*([\s\S]+)$/i;
const PILLAR = /^(?:please\s+|can you\s+)?(?:add|create|new)\s+(?:a\s+)?(?:new\s+)?pillar\s*(?:called|named|:)?\s*(.+)$/i;

export function namedCommand(message: string): NamedCommand | null {
  const msg = message.trim();
  const idea = IDEA.exec(msg);
  if (idea && idea[1].trim()) return { type: "idea", text: idea[1].trim() };
  const pillar = PILLAR.exec(msg);
  if (pillar) {
    const name = pillar[1].replace(/^["“]|["”.?]$/g, "").trim();
    if (name) return { type: "pillar", name };
  }
  return null;
}
