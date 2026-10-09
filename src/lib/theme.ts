/** Appearance preference: a per-browser UI setting kept in a cookie (not account data). */
export const THEME_COOKIE = "huemen_theme";
export const THEMES = ["dark", "light", "system"] as const;
export type ThemePref = (typeof THEMES)[number];
export type Theme = "dark" | "light";

/**
 * The device's own setting is the default, as in the design system (§04: both
 * themes are first-class, light is the reference). An explicit choice wins;
 * anything unrecognised falls back to following the device.
 */
export function parseTheme(v: string | undefined | null): ThemePref {
  return v === "light" || v === "dark" ? v : "system";
}
