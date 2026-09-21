/**
 * Intake parser (brief §4.1: "post-workshop summary can be pasted in and parsed
 * into fields"). Pure and deterministic: it maps LABELLED lines/sections
 * ("Niche: …", "Audience", "Don't words: …") onto foundation fields and pulls
 * hex colours from anywhere. Text it cannot place is returned as `unplaced` so
 * the UI can show it — nothing is silently dropped or invented.
 */
import type { FoundationForm } from "@/lib/data/foundation-types";

type Key =
  | "niche" | "positioning" | "audience" | "offers" | "tone" | "doWords" | "dontWords"
  | "readingLevel" | "samplePosts" | "palette" | "fonts" | "imageStyleNotes"
  | "ch0" | "ch1" | "ch2";

const LABELS: [RegExp, Key][] = [
  [/^niche$/, "niche"],
  [/^(positioning|positioning statement|what (i|they|we) do|who (i|we) help)$/, "positioning"],
  [/^(audience|target audience|who it'?s for)$/, "audience"],
  [/^(offers?|services?|products?)$/, "offers"],
  [/^(tone|voice|tone of voice|tone descriptors)$/, "tone"],
  [/^(do[- ]?words|words to use|use)$/, "doWords"],
  [/^(don'?t[- ]?words|dont[- ]?words|words to avoid|avoid|banned words)$/, "dontWords"],
  [/^(reading level)$/, "readingLevel"],
  [/^(sample posts?|examples?|past posts?)$/, "samplePosts"],
  [/^(palette|colou?rs?|brand colou?rs?)$/, "palette"],
  [/^(fonts?|typography|typefaces?)$/, "fonts"],
  [/^(image style|visual style|image style notes|imagery)$/, "imageStyleNotes"],
  [/^(chapter 1|origin|where it started|story)$/, "ch0"],
  [/^(chapter 2|turning point)$/, "ch1"],
  [/^(chapter 3|now|today)$/, "ch2"],
];

function labelOf(raw: string): Key | null {
  const k = raw.toLowerCase().replace(/[#*_]/g, "").replace(/[:\-–]\s*$/, "").trim();
  for (const [re, key] of LABELS) if (re.test(k)) return key;
  return null;
}

export interface IntakeResult {
  fields: Partial<Record<Key, string>>;
  unplaced: string;
  placedCount: number;
}

export function parseIntake(text: string): IntakeResult {
  const fields: Partial<Record<Key, string>> = {};
  const unplaced: string[] = [];
  let current: Key | null = null;
  // After a heading, every line belongs to it; after an inline "Label: value",
  // only bullet lines continue it (a plain line is a new, unlabelled thought).
  let fromHeading = false;

  const push = (key: Key, value: string) => {
    const v = value.trim();
    if (!v) return;
    fields[key] = fields[key] ? `${fields[key]}\n${v}` : v;
  };

  for (const line of text.replace(/\r/g, "").split("\n")) {
    const inline = line.match(/^\s*[#*_-]*\s*([A-Za-z' ]{2,32}?)\s*[:–-]\s+(.+)$/);
    if (inline && labelOf(inline[1])) {
      current = labelOf(inline[1]);
      fromHeading = false;
      push(current!, inline[2]);
      continue;
    }
    const heading = line.match(/^\s*[#*_]*\s*([A-Za-z' ]{2,32}?)\s*:?\s*[#*_]*\s*$/);
    if (heading && labelOf(heading[1])) {
      current = labelOf(heading[1]);
      fromHeading = true;
      continue;
    }
    if (!line.trim()) continue;
    const isBullet = /^\s*[-*•]\s+/.test(line);
    const bullet = line.replace(/^\s*[-*•]\s+/, "");
    if (current && (fromHeading || isBullet)) push(current, bullet);
    else unplaced.push(line.trim());
  }

  // Hex colours anywhere count towards the palette.
  const hexes = Array.from(new Set((text.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) ?? []).map((h) => h.toUpperCase())));
  if (hexes.length) fields.palette = hexes.join(", ");

  // List-style fields become comma lists.
  for (const k of ["tone", "doWords", "dontWords", "fonts"] as const) {
    if (fields[k]) fields[k] = fields[k]!.split(/[\n,;]/).map((s) => s.trim()).filter(Boolean).join(", ");
  }

  return { fields, unplaced: unplaced.join("\n"), placedCount: Object.keys(fields).length };
}

/** Merge parsed fields over an existing foundation — only non-empty values win. */
export function mergeIntake(base: FoundationForm, r: IntakeResult): FoundationForm {
  const f = r.fields;
  const pick = (a: string, b?: string) => (b && b.trim() ? b.trim() : a);
  return {
    ...base,
    niche: pick(base.niche, f.niche),
    positioning: pick(base.positioning, f.positioning),
    audience: pick(base.audience, f.audience),
    offers: pick(base.offers, f.offers),
    tone: pick(base.tone, f.tone),
    doWords: pick(base.doWords, f.doWords),
    dontWords: pick(base.dontWords, f.dontWords),
    readingLevel: pick(base.readingLevel, f.readingLevel),
    samplePosts: pick(base.samplePosts, f.samplePosts),
    palette: pick(base.palette, f.palette),
    fonts: pick(base.fonts, f.fonts),
    imageStyleNotes: pick(base.imageStyleNotes, f.imageStyleNotes),
    chapters: base.chapters.map((ch, i) => {
      const body = f[(`ch${i}`) as "ch0" | "ch1" | "ch2"];
      return body ? { title: ch.title || ["Origin", "Turning point", "Now"][i], body } : ch;
    }),
  };
}
