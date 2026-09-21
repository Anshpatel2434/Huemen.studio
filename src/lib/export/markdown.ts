/**
 * Markdown / Notion-compatible export (brief §4.5, §09 decision #5: Markdown,
 * no Notion API). Carries the client's brand name only — no Okra marks (§4.7).
 * Pure: takes already-loaded, tenant-scoped data.
 */
import type { FoundationForm } from "@/lib/data/foundation-types";
import type { ContentItemView } from "@/lib/data/content";
import type { CalendarEntryView, OfferView, PillarView } from "@/lib/data/planning";
import { formatByKey } from "@/lib/content/formats";

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

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
  const h = (lvl: number, t: string) => out.push("", `${"#".repeat(lvl)} ${t}`, "");

  out.push(`# ${name}: brand brief`, "", `_Exported ${input.generatedAt.toISOString().slice(0, 10)}_`);

  h(2, "What they do");
  if (f.niche) out.push(`**Niche:** ${f.niche}`, "");
  if (f.positioning) out.push(f.positioning);
  if (f.audience) { h(3, "Audience"); out.push(f.audience); }
  if (f.chapters.some((c) => c.body)) {
    h(3, "Story arc");
    f.chapters.forEach((c, i) => c.body && out.push(`${i + 1}. **${c.title || ["Origin", "Turning point", "Now"][i]}.** ${c.body}`));
  }

  h(2, "Voice");
  if (f.tone) out.push(`- **Tone:** ${f.tone}`);
  if (f.readingLevel) out.push(`- **Reading level:** ${f.readingLevel}`);
  if (list(f.doWords).length) out.push(`- **Use:** ${list(f.doWords).join(", ")}`);
  if (list(f.dontWords).length) out.push(`- **Never use:** ${list(f.dontWords).join(", ")}`);

  h(2, "Visual identity");
  if (list(f.palette).length) out.push(`- **Palette:** ${list(f.palette).map((c) => `\`${c}\``).join(" ")}`);
  if (f.fonts) out.push(`- **Fonts:** ${f.fonts}`);
  if (f.imageStyleNotes) out.push(`- **Imagery:** ${f.imageStyleNotes}`);

  if (input.pillars.length) {
    h(2, "Content pillars");
    input.pillars.forEach((p) => out.push(`- **${p.name}**${p.description ? `: ${p.description}` : ""}`));
  }

  if (input.offers.length) {
    h(2, "Offers");
    input.offers.forEach((o) => {
      h(3, o.name);
      if (o.format) out.push(`_${o.format}_`, "");
      if (o.promise) out.push(`> ${o.promise}`, "");
      o.deliverables.forEach((d) => out.push(`- ${d}`));
      if (o.pricingLogic) out.push("", `**Pricing logic:** ${o.pricingLogic}`);
    });
  }

  if (input.calendar.length) {
    h(2, "Calendar");
    out.push("| Date | Channel | Pillar | Topic |", "| --- | --- | --- | --- |");
    input.calendar.forEach((e) => out.push(`| ${e.date} | ${e.channel ?? ""} | ${e.pillarName ?? ""} | ${(e.topic ?? "").replace(/\|/g, "\\|")} |`));
  }

  if (input.content.length) {
    h(2, "Content");
    input.content.forEach((c) => {
      h(3, `${formatByKey(c.format).label}${c.topic ? `: ${c.topic}` : ""}`);
      out.push(`_Status: ${c.status}${c.pillarName ? ` · Pillar: ${c.pillarName}` : ""}_`, "");
      if (c.hook) out.push(`**${c.hook}**`, "");
      if (c.body) out.push(c.body, "");
      if (c.cta) out.push(`→ ${c.cta}`);
    });
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
