import type { Metadata } from "next";
import { Inter, Newsreader } from "next/font/google";
import "./globals.css";

// Borna (Sahil's display face) is a commercial licence — see P1-12 font-licence
// decision. Inter is the free grotesque substitute; Newsreader supplies the
// serif-italic accent. Swap in the licensed faces once confirmed.
const borna = Inter({ variable: "--font-borna", subsets: ["latin"] });
const editorial = Newsreader({
  variable: "--font-editorial",
  subsets: ["latin"],
  style: ["italic", "normal"],
});

// White-label: no Okra Tech Labs marks anywhere client-facing (brief §4.7).
export const metadata: Metadata = {
  title: "Huemen.studio",
  description: "Your personal brand, generated from one stored context.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${borna.variable} ${editorial.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-paper text-ink">{children}</body>
    </html>
  );
}
