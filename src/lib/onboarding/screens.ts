/**
 * The short onboarding (Obello-style): one question per screen, seven screens.
 * Client-safe, so the screens and the page agree on order and names.
 *
 * The stored `onboarding.step` (0 About you · 1 Add samples · 2 Confirm · 3 Hue
 * · 4 First draft) is still written as screens are passed, so the dashboard
 * gate, the Voice page and older links keep working. `onboarding.screen` is
 * the furthest screen reached.
 */
import type { Onboarding } from "@/lib/voice/types";

export const SCREENS = ["site", "name", "audience", "writing", "look", "words", "draft"] as const;
export type ScreenKey = (typeof SCREENS)[number];
export const LAST_SCREEN = SCREENS.length - 1;

/** The old step each screen belongs to; `updateOnboarding` keeps the max. */
export const LEGACY_STEP: Record<ScreenKey, number> = { site: 0, name: 0, audience: 0, writing: 1, look: 3, words: 2, draft: 4 };

/** Older `?step=` links (Settings, Check, the integrations callback) land on the matching screen. */
const FROM_LEGACY: ScreenKey[] = ["name", "writing", "words", "look", "draft"];
export const screenForLegacyStep = (step: number): ScreenKey => FROM_LEGACY[Math.min(4, Math.max(0, step))];

export const screenIndex = (k: ScreenKey) => SCREENS.indexOf(k);
export const isScreen = (v: unknown): v is ScreenKey => typeof v === "string" && (SCREENS as readonly string[]).includes(v);

/**
 * The furthest screen reached. Packs from before the short flow have no
 * `screen`; their old step stands in for it.
 */
export function resumeScreen(o: Onboarding): number {
  if (o.completedAt) return LAST_SCREEN;
  if (typeof o.screen === "number") return Math.min(LAST_SCREEN, Math.max(0, o.screen));
  if (!o.welcomedAt) return 0;
  const step = o.step ?? 1;
  return step >= 4 ? 6 : step >= 2 ? 4 : 3;
}
