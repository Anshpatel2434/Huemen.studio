"use server";

import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";

/**
 * Persist the appearance preference. The client has already swapped
 * `<html data-theme>`, so there is nothing to re-render: no revalidate.
 */
export async function saveThemeAction(value: string): Promise<void> {
  (await cookies()).set(THEME_COOKIE, parseTheme(value), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
}
