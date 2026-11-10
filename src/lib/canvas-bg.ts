/** Canvas background: a per-browser UI setting kept in a cookie, like the theme. */
export const CANVAS_COOKIE = "huemen_canvas";
export const CANVAS_BGS = ["plain", "dots", "grid", "scaled", "lines"] as const;
export type CanvasBg = (typeof CANVAS_BGS)[number];

export const CANVAS_LABEL: Record<CanvasBg, { label: string; hint: string }> = {
  plain: { label: "Plain", hint: "Quiet and warm, like a board" },
  dots: { label: "Dotted grid", hint: "A dot every 24px" },
  grid: { label: "Grid", hint: "Fine lines every 24px" },
  scaled: { label: "Scaled grid", hint: "Fine lines, a stronger one every 5" },
  lines: { label: "Ruled", hint: "Horizontal rules, like a notebook" },
};

/** Plain is the default; anything unrecognised falls back to it. */
export function parseCanvasBg(v: string | undefined | null): CanvasBg {
  return (CANVAS_BGS as readonly string[]).includes(v ?? "") ? (v as CanvasBg) : "plain";
}
