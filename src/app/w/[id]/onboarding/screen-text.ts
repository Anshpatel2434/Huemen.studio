/**
 * Small pure helpers for the short onboarding screens (short-flow.tsx): how a
 * saved piece of writing is named and quoted on the Writing screen, and where
 * a colour on the Look screen came from. Pure so they are testable without a
 * browser (tests/onboarding-small-*.test.ts).
 */

const CHANNEL_LABEL: Record<string, string> = {
  linkedin: "LinkedIn",
  instagram: "Instagram",
  x: "X",
  threads: "Threads",
  newsletter: "Newsletter or blog",
  email: "Sent email",
  spoken: "Spoken",
};

const SOURCE_LABEL: Record<string, string> = {
  paste: "pasted",
  upload: "file",
  export: "export",
  url: "link",
  connection: "connected",
  intake: "setup",
  studio: "studio",
};

/** "LinkedIn · pasted", "Newsletter or blog · link", "Spoken answer". */
export function pieceLabel(channel: string, source: string): string {
  if (source === "voice_note") return "Spoken answer";
  const ch = CHANNEL_LABEL[channel] ?? (channel && channel !== "unknown" ? channel[0].toUpperCase() + channel.slice(1) : "Writing");
  const src = SOURCE_LABEL[source];
  return src ? `${ch} · ${src}` : ch;
}

/** The first line of a piece, cut at a word near `max` characters. */
export function pieceExcerpt(body: string, max = 110): string {
  const line = (body.split(/\n/).map((l) => l.replace(/\s+/g, " ").trim()).find(Boolean) ?? "");
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

export type SavedPiece = { id: string; label: string; excerpt: string };

/** Saved samples as the Writing screen lists them: newest first, at most `limit`. */
export function savedPieces(
  samples: { id: string; channel: string; source: string; body: string; note?: string }[],
  limit = 50,
): SavedPiece[] {
  return samples
    .slice(-limit)
    .reverse()
    .map((s) => ({
      id: s.id,
      label: pieceLabel(s.channel, s.source),
      // A page read from a link carries its title; that names it better than its first line.
      excerpt: s.source === "url" && s.note?.trim() ? pieceExcerpt(s.note) : pieceExcerpt(s.body),
    }));
}

/** "focuslab.agency" from "https://www.focuslab.agency/". */
export const siteDomain = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

const sameHex = (a: string | undefined, b: string | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The tag on the Look screen's colours. It names the site only while a value
 * is still exactly what the site read gave; once the person changes one it
 * says so. Null when no site was read or the read found no colours.
 */
export function colourSource(colours: string[], sitePalette: string[], site: string | null, roles = ["Background", "Accent"]): string | null {
  if (!site || !sitePalette.length) return null;
  const from = roles.map((_, i) => sameHex(colours[i], sitePalette[i]));
  const domain = siteDomain(site);
  if (from.every(Boolean)) return `From ${domain}`;
  if (!from.some(Boolean)) return "Your choice";
  return `${roles[from.indexOf(true)]} from ${domain}`;
}
