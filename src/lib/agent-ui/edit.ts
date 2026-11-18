/**
 * What an "Ask Huemen" message asks to change on the piece that is open, or
 * whether it asks for a new piece. Pure: the command path (agent-actions)
 * decides what to do with the answer.
 *
 * The rule the QA run (2026-11-18, F4) asked for: "make the hook more
 * contrarian" is about the piece on screen, so it edits that piece. Only a
 * request for a new one ("draft a new post", "write a hook about pricing") makes
 * an item. A message is an edit only when it refers to the piece ("the hook",
 * "this post", "it") and asks for a change, and it names no topic.
 */

export type EditPart = "hook" | "body" | "cta" | "pillar" | "angle" | "length" | "whole";

export interface PieceEdit {
  part: EditPart;
}

/** A request for something new, never a change to what is open. */
const NEW_PIECE = /\b(new|another|fresh|separate|brand new|different one)\b/i;
/** A topic named in the message: "draft a post about pricing". */
const TOPIC = /\babout\s+\S/i;
/** The message points at the piece that is open. */
const REFERS = /\b(the|this|that|its|it|my|current|open)\b/i;
/** Asks for a change to something that exists. */
const CHANGE = /\b(more|less|shorter|longer|punchier|tighter|sharper|contrarian|warmer|softer|bolder|simpler|stronger|rewrite|change|edit|fix|improve|tweak|rework|sharpen|soften|shorten|tighten|trim|cut|swap|replace|move|punch|lengthen)\b/i;

/**
 * The part a change is about. Checked in this order: a pillar or angle is
 * about the piece's setup; the call to action, the hook and the body are named
 * parts; a length ask is the whole piece; anything else is the whole piece.
 */
function partOf(message: string): EditPart {
  if (/\bpillar\b/i.test(message)) return "pillar";
  if (/\bangle\b/i.test(message)) return "angle";
  if (/\b(cta|call to action|ending|closing|last line|sign-?off)\b/i.test(message)) return "cta";
  if (/\b(hook|opener|opening|headline|first line|intro|lede|title)\b/i.test(message)) return "hook";
  if (/\b(body|middle|paragraphs?|the rest)\b/i.test(message)) return "body";
  if (/\b(shorter|longer|shorten|lengthen|trim|length)\b/i.test(message)) return "length";
  return "whole";
}

/**
 * The edit a message asks for, or null when it is not an edit of the open piece
 * (a request for a new piece, a topic, or no reference to a piece at all).
 */
export function pieceEdit(message: string): PieceEdit | null {
  const m = message.trim();
  if (!m) return null;
  if (NEW_PIECE.test(m) || TOPIC.test(m)) return null;
  if (!REFERS.test(m) || !CHANGE.test(m)) return null;
  return { part: partOf(m) };
}
