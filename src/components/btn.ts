/**
 * Button recipe — plain module so server and client components can both call it.
 *
 * Follows the hueman design system §09: buttons are PILLS, primary is ink,
 * accent is the brand blue (violet in dark), secondary is an outline, ghost is
 * bare text, and destructive is a real red fill rather than red text. Sizes are
 * the system's control heights, and all three clear the 44px floor — "the small
 * size is the minimum, not smaller than the minimum" (§02). Heights are
 * min-height rather than height so a label can wrap without clipping.
 *
 * A control that must LOOK smaller than 44px keeps its visual size and takes
 * the `hu-hit` class, which expands the target with a transparent
 * pseudo-element. That is the system's own sanctioned escape hatch, and the
 * only one.
 */
export type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-on-ink hover:opacity-90",
  accent: "bg-accent text-accent-fg hover:opacity-90",
  secondary: "bg-transparent text-ink border border-line hover:border-ink hover:bg-field",
  ghost: "text-ink-muted hover:text-ink hover:bg-field",
  danger: "bg-danger text-danger-fg hover:opacity-90",
};

export function btnClass(variant: Variant = "primary", size: "sm" | "md" | "lg" = "md") {
  const s =
    size === "sm"
      ? "min-h-11 px-5 py-2 text-[0.875rem]"
      : size === "lg"
        ? "min-h-14 px-10 py-3 text-[1.06rem]"
        : "min-h-11 px-7 py-2 text-[0.95rem]";
  return [
    "inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap",
    "transition-colors duration-150 active:translate-y-[0.5px]",
    "disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none",
    s,
    VARIANTS[variant],
  ].join(" ");
}
