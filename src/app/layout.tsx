import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Archivo, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { PageTransition } from "@/components/page-transition";
import { ThemeProvider } from "@/components/theme";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";

/*
 * The design system's documented fallbacks (§03), in place of the licensed GT
 * America / GT Super / GT America Mono until Grilli Type's web licence lands:
 * Archivo carries the interface, Instrument Serif the editorial statements,
 * IBM Plex Mono the labels and numbers.
 */
const sans = Archivo({ variable: "--font-sans-src", subsets: ["latin", "latin-ext"], weight: ["400", "500", "600", "700"], display: "swap" });
const serif = Instrument_Serif({ variable: "--font-serif-src", subsets: ["latin"], weight: "400", style: ["normal", "italic"], display: "swap" });
const mono = IBM_Plex_Mono({ variable: "--font-mono-src", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Huemen.studio", template: "%s · Huemen.studio" },
  description: "Your personal brand, defined once. Everything else is generated from it.",
};

/** Appearance: follows the device by default (design system §04); light or dark from Settings. */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={theme} className={`${sans.variable} ${serif.variable} ${mono.variable} h-full`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <ThemeProvider initial={theme}>
          <PageTransition level="section">{children}</PageTransition>
        </ThemeProvider>
      </body>
    </html>
  );
}
