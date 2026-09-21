/** Appearance preference: a per-browser UI setting kept in a cookie (not account data). */
export const THEME_COOKIE = "huemen_theme";
export const THEMES = ["dark", "light", "system"] as const;
export type ThemePref = (typeof THEMES)[number];
export type Theme = "dark" | "light";

/** Dark is the default (Figma-like); anything unrecognised falls back to it. */
export function parseTheme(v: string | undefined | null): ThemePref {
  return v === "light" || v === "system" ? v : "dark";
}
