/**
 * Where the numbered pins of the comments on one visual sit. Pure.
 *
 * A pin belongs on the top-left corner of its comment's box. Boxes drawn on
 * the same spot put their pins on top of each other, so only the last number
 * could be read or clicked (2026-11-17). Pins are placed in number order, and
 * one that would cover an earlier pin moves right along its box's top edge
 * until it is clear: every number stays readable and clickable, and still
 * touches its own box.
 */
export const PIN_SIZE = 24;
const PIN_GAP = 2;

export function placePins(
  boxes: { id: string; left: number; top: number }[],
  size = PIN_SIZE,
): Record<string, { left: number; top: number }> {
  const placed: { left: number; top: number }[] = [];
  const out: Record<string, { left: number; top: number }> = {};
  const step = size + PIN_GAP;
  for (const b of boxes) {
    let left = b.left - size / 2;
    const top = b.top - size / 2;
    while (placed.some((p) => Math.abs(p.left - left) < step && Math.abs(p.top - top) < step)) left += step;
    placed.push({ left, top });
    out[b.id] = { left, top };
  }
  return out;
}
