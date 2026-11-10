"use server";

import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { CANVAS_COOKIE, parseCanvasBg } from "@/lib/canvas-bg";

const YEAR = 60 * 60 * 24 * 365;

/**
 * Persist the appearance preference. The client has already swapped
 * `<html data-theme>`, so there is nothing to re-render: no revalidate.
 */
export async function saveThemeAction(value: string): Promise<void> {
  (await cookies()).set(THEME_COOKIE, parseTheme(value), { path: "/", maxAge: YEAR, sameSite: "lax", httpOnly: true });
}

/** Persist the canvas background. Same as the theme: the client already swapped `<html data-canvas>`. */
export async function saveCanvasAction(value: string): Promise<void> {
  (await cookies()).set(CANVAS_COOKIE, parseCanvasBg(value), { path: "/", maxAge: YEAR, sameSite: "lax", httpOnly: true });
}
