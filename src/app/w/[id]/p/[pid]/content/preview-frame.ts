import { formatByKey, FORMATS } from "@/lib/content/formats";

/**
 * Which channel-shaped frame a piece is previewed in on the Content canvas.
 *
 * Every piece used to be drawn as a LinkedIn post (likes, comments, repost),
 * so an Instagram carousel looked like LinkedIn (2026-11-18). Each format now
 * gets its own platform's frame, or a neutral page when the platform has no
 * feed of its own (a talk abstract, a bio, a LinkedIn comment reply).
 */
export type PreviewFrame = "linkedin" | "instagram" | "x" | "threads" | "message" | "email" | "neutral";

export function previewFrameOf(formatKey: string): PreviewFrame {
  // An unknown format falls back to neutral, never to LinkedIn's chrome.
  if (!FORMATS.some((f) => f.key === formatKey)) return "neutral";
  const f = formatByKey(formatKey);
  switch (f.channel) {
    case "linkedin": return f.reply ? "neutral" : "linkedin";
    case "instagram": return "instagram";
    case "x": return "x";
    case "threads": return "threads";
    case "chat": return "message";
    case "newsletter":
    case "email": return "email";
    default: return "neutral";
  }
}
