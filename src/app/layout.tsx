import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Inter, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { PageTransition } from "@/components/page-transition";
import { ThemeProvider } from "@/components/theme";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";

const inter = Inter({ variable: "--font-sans-src", subsets: ["latin"], display: "swap" });
const serif = Instrument_Serif({ variable: "--font-serif-src", subsets: ["latin"], weight: "400", style: ["normal", "italic"], display: "swap" });
const mono = IBM_Plex_Mono({ variable: "--font-mono-src", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Huemen.studio", template: "%s · Huemen.studio" },
  description: "Your personal brand, defined once. Everything else is generated from it.",
};

/** Appearance: dark by default (Figma-style); light or system from Settings. */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={theme} className={`${inter.variable} ${serif.variable} ${mono.variable} h-full`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <ThemeProvider initial={theme}>
          <PageTransition level="section">{children}</PageTransition>
        </ThemeProvider>
      </body>
    </html>
  );
}
