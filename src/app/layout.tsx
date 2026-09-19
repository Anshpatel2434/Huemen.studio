import type { Metadata } from "next";
import { Inter, Space_Grotesk, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-sans-src", subsets: ["latin"], display: "swap" });
const display = Space_Grotesk({ variable: "--font-display-src", subsets: ["latin"], display: "swap", weight: ["400", "500", "600", "700"] });
const serif = Instrument_Serif({ variable: "--font-serif-src", subsets: ["latin"], weight: "400", style: ["normal", "italic"], display: "swap" });
// Monospace — for metadata labels + technical micro-text (editorial signal).
const mono = IBM_Plex_Mono({ variable: "--font-mono-src", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

export const metadata: Metadata = {
  title: "Huemen.studio",
  description: "Your personal brand, generated from one stored context.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable} ${serif.variable} ${mono.variable} h-full`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
