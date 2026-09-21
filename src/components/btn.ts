/** Button class recipe — plain module so server and client components can both call it. */
export type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-on-ink hover:opacity-90",
  accent: "bg-accent text-on-ink hover:bg-accent-ink",
  secondary: "bg-paper text-ink border border-line hover:border-ink",
  ghost: "text-ink-muted hover:text-ink hover:bg-field",
  danger: "text-accent-ink hover:bg-accent-soft",
};

export function btnClass(variant: Variant = "primary", size: "sm" | "md" = "md") {
  const s = size === "sm" ? "h-8 px-3 text-[0.8rem]" : "h-9 px-4 text-[0.85rem]";
  return `inline-flex items-center justify-center gap-1.5 rounded-[8px] font-medium whitespace-nowrap transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none ${s} ${VARIANTS[variant]}`;
}

