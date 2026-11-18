/**
 * Markdown / Notion-compatible export (brief §4.5, §09 decision #5: Markdown,
 * no Notion API). Carries the client's brand name only — no Okra marks (§4.7).
 * Pure: takes already-loaded, tenant-scoped data.
 *
 * Everything a person typed is escaped before it goes in (`t`): most Markdown
 * readers render raw HTML, so a "<script>" or an "<img onerror>" in a topic or
 * a post would otherwise run, or vanish, wherever the file is opened. Angle
 * brackets and ampersands become entities, which every reader shows as the
 * characters they are.
 */
import type { FoundationForm } from "@/lib/data/foundation-types";
import type { ContentItemView } from "@/lib/data/content";
import type { CalendarEntryView, OfferView, PillarView } from "@/lib/data/planning";
import { formatByKey } from "@/lib/content/formats";

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/** User text, safe to place in Markdown: no raw HTML gets through. */
export const escapeMarkdownText = (s: string | null | undefined): string =>
  (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const t = escapeMarkdownText;
/** The same, for a table cell: one line, and a pipe can't end the cell. */
const cell = (s: string | null | undefined) => t(s).replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|");

/** A name as a file-name part: lower case, hyphens, no more than `max` characters. */
export function fileSlug(name: string | null | undefined, max = 60): string {
  const slug = (name ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.slice(0, max).replace(/-+$/, "");
}

/** "<brand>-<project>-brief.<ext>": which brand, and which piece of work the export was taken from. */
export function exportFileName(brand: string, project: string | null | undefined, ext: "md" | "pdf"): string {
  const b = fileSlug(brand, 40) || "brand";
  const p = fileSlug(project, 50);
  return `${p && p !== b ? `${b}-${p}` : b}-brief.${ext}`;
}

export function buildMarkdown(input: {
  brandName: string;
  foundation: FoundationForm;
  pillars: PillarView[];
  content: ContentItemView[];
  calendar: CalendarEntryView[];
  offers: OfferView[];
  generatedAt: Date;
}): string {
  const { brandName: name, foundation: f } = input;
  const out: string[] = [];
  const h = (lvl: number, title: string) => out.push("", `${"#".repeat(lvl)} ${title}`, "");

  out.push(`# ${t(name)}: brand brief`, "", `_Exported ${input.generatedAt.toISOString().slice(0, 10)}_`);

  h(2, "What they do");
  if (f.niche) out.push(`**Niche:** ${t(f.niche)}`, "");
  if (f.positioning) out.push(t(f.positioning));
  if (f.audience) { h(3, "Audience"); out.push(t(f.audience)); }
  if (f.chapters.some((c) => c.body)) {
    h(3, "Story arc");
    f.chapters.forEach((c, i) => c.body && out.push(`${i + 1}. **${t(c.title) || ["Origin", "Turning point", "Now"][i]}.** ${t(c.body)}`));
  }

  h(2, "Voice");
  if (f.tone) out.push(`- **Tone:** ${t(f.tone)}`);
  if (f.readingLevel) out.push(`- **Reading level:** ${t(f.readingLevel)}`);
  if (list(f.doWords).length) out.push(`- **Use:** ${list(f.doWords).map(t).join(", ")}`);
  if (list(f.dontWords).length) out.push(`- **Never use:** ${list(f.dontWords).map(t).join(", ")}`);

  h(2, "Visual identity");
  if (list(f.palette).length) out.push(`- **Palette:** ${list(f.palette).map((c) => `\`${t(c).replace(/`/g, "")}\``).join(" ")}`);
  if (f.fonts) out.push(`- **Fonts:** ${t(f.fonts)}`);
  if (f.imageStyleNotes) out.push(`- **Imagery:** ${t(f.imageStyleNotes)}`);

  if (input.pillars.length) {
    h(2, "Content pillars");
    input.pillars.forEach((p) => out.push(`- **${t(p.name)}**${p.description ? `: ${t(p.description)}` : ""}`));
  }

  if (input.offers.length) {
    h(2, "Offers");
    input.offers.forEach((o) => {
      h(3, t(o.name));
      if (o.format) out.push(`_${t(o.format)}_`, "");
      if (o.promise) out.push(`> ${t(o.promise)}`, "");
      o.deliverables.forEach((d) => out.push(`- ${t(d)}`));
      if (o.pricingLogic) out.push("", `**Pricing logic:** ${t(o.pricingLogic)}`);
    });
  }

  if (input.calendar.length) {
    h(2, "Calendar");
    out.push("| Date | Channel | Pillar | Topic |", "| --- | --- | --- | --- |");
    input.calendar.forEach((e) => out.push(`| ${e.date} | ${cell(e.channel)} | ${cell(e.pillarName)} | ${cell(e.topic)} |`));
  }

  if (input.content.length) {
    h(2, "Content");
    input.content.forEach((c) => {
      h(3, `${formatByKey(c.format).label}${c.topic ? `: ${t(c.topic).replace(/\s*\n\s*/g, " ")}` : ""}`);
      out.push(`_Status: ${c.status}${c.pillarName ? ` · Pillar: ${t(c.pillarName)}` : ""}_`, "");
      if (c.hook) out.push(`**${t(c.hook)}**`, "");
      if (c.body) out.push(t(c.body), "");
      if (c.cta) out.push(`→ ${t(c.cta)}`);
    });
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
