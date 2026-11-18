import type { Metadata } from "next";
import { cookies } from "next/headers";
import { preload } from "react-dom";
import "./fonts.css";
import "./globals.css";
import { PageTransition } from "@/components/page-transition";
import { ThemeProvider } from "@/components/theme";
import { StudioCursor } from "@/components/cursor";
import { FieldErrors } from "@/components/field-errors";
import { UnsavedGuardRoot } from "@/components/unsaved-guard";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { CANVAS_COOKIE, parseCanvasBg } from "@/lib/canvas-bg";

/*
 * The design system's documented fallbacks (§03), in place of the licensed GT
 * America / GT Super / GT America Mono until Grilli Type's web licence lands:
 * Archivo carries the interface, Instrument Serif the editorial statements,
 * IBM Plex Mono the labels and numbers. Self-hosted (fonts.css, public/fonts)
 * so the build never fetches from Google; the Latin files load first.
 */
const PRELOAD = [
  "archivo-latin-variable",
  "instrument-serif-latin-400",
  "instrument-serif-latin-400-italic",
  "ibm-plex-mono-latin-400",
  "ibm-plex-mono-latin-500",
];

export const metadata: Metadata = {
  title: { default: "Huemen.studio", template: "%s · Huemen.studio" },
  description: "Your personal brand, defined once. Everything else is generated from it.",
};

/** Appearance: follows the device by default (design system §04); light or dark from Settings. */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const jar = await cookies();
  const theme = parseTheme(jar.get(THEME_COOKIE)?.value);
  const canvas = parseCanvasBg(jar.get(CANVAS_COOKIE)?.value);
  for (const f of PRELOAD) preload(`/fonts/${f}.woff2`, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  return (
    <html lang="en" data-theme={theme} data-canvas={canvas} className="h-full" suppressHydrationWarning>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <ThemeProvider initial={theme}>
          <PageTransition level="section">{children}</PageTransition>
          <FieldErrors />
          <UnsavedGuardRoot />
        </ThemeProvider>
        <StudioCursor />
      </body>
    </html>
  );
}
