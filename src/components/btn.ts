/**
 * Button recipe — plain module so server and client components can both call it.
 *
 * Follows the hueman design system §09: buttons are PILLS, primary is ink,
 * accent is the brand blue (violet in dark), secondary is an outline, ghost is
 * bare text, and destructive is a real red fill rather than red text. Sizes are
 * the system's control heights (§05): sm 44, md 48, lg 56. All clear the 44px
 * floor — "the small size is the minimum, not smaller than the minimum" (§02).
 * Heights are min-height so a label can wrap without clipping.
 *
 * A control that must LOOK smaller than 44px is an icon button (`.hu-iconbtn`)
 * or a segment (`.hu-seg__item`), which keep their look and extend the target
 * with a transparent pseudo-element; `hu-hit` does the same for anything else.
 */
export type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger";
export type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-on-ink border border-transparent hover:opacity-90",
  accent: "bg-accent text-accent-fg border border-transparent hover:opacity-90",
  secondary: "bg-transparent text-ink border border-line hover:border-line-strong hover:bg-hover",
  ghost: "bg-transparent text-ink border border-transparent hover:bg-hover",
  danger: "bg-danger text-danger-fg border border-transparent hover:opacity-90",
};

const SIZES: Record<Size, string> = {
  sm: "min-h-11 px-5 text-sm",
  md: "min-h-12 px-7 text-base",
  lg: "min-h-14 px-10 text-base",
};

export function btnClass(variant: Variant = "primary", size: Size = "md") {
  return [
    "inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap leading-none",
    "transition-[background-color,border-color,color,opacity,transform] duration-[120ms] ease-[cubic-bezier(.2,0,0,1)]",
    // Press feedback (§06): a 2% give, never a bounce; off under reduced motion.
    "motion-safe:active:scale-[0.98]",
    "disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none aria-busy:pointer-events-none",
    SIZES[size],
    VARIANTS[variant],
  ].join(" ");
}

/** The compact icon-only control. Pass an aria-label: it says the action, not the icon. */
export function iconBtnClass(extra = "") {
  return `hu-iconbtn ${extra}`.trim();
}
