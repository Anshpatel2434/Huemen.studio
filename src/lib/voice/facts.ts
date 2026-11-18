/**
 * Facts a draft may not invent (lib/ai/prompt, FACTS_RULE), found by code.
 *
 * The model is told never to state a number, a client, an event or a named
 * method the brand context does not contain. That rule is prompt-only, and a
 * QA run (2026-11-17) found drafts that broke it anyway: invented team events,
 * a made-up "3-Q Review", a quoted client metric. So the text it wrote is
 * checked against the brand context here, every time.
 *
 * It is deliberately narrow. It catches the patterns that were seen: a number
 * in a first-person sentence (or a percentage or amount anywhere), a quoted
 * line with a speaker, a first-person "we shipped / killed / built" claim or a
 * "a client told me" event, and a named method. Anything the brand context
 * supports is let through: a sentence whose words run on from the context (four
 * words in a row, the story as told), a number the context states, a quote the
 * context contains.
 *
 * The check never blocks drafting. Its findings are must-fix items on the brand
 * check (lib/voice/check). Pure: no I/O.
 */

export type ClaimKind = "number" | "quote" | "event" | "method";

export interface UnsupportedClaim {
  kind: ClaimKind;
  /** The sentence or phrase that states it, as written, trimmed. */
  excerpt: string;
}

/** Number words a draft might use for a count (not "one": "one client" is an event, not a figure). */
const NUMBER_WORDS: Record<string, string> = {
  two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", fifteen: "15", twenty: "20", thirty: "30", forty: "40", fifty: "50",
  hundred: "100", thousand: "1000", million: "1000000", dozen: "12",
};

const FIRST_PERSON = /\b(i|i'm|i've|i'd|me|my|mine|we|we're|we've|our|ours|us)\b/i;
const MONEY_OR_PERCENT = /[%$£€₹]|\b(?:percent|per cent)\b/i;
/** A first-person work claim: "we shipped", "I've built", "we killed". */
const EVENT = /\b(?:i|we)(?:['’](?:ve|d))?\s+(?:[a-z]+\s+)?(?:shipped|killed|built|launched|scrapped|rebuilt|delivered|closed|hired|fired|sold|raised|grew|doubled|tripled|replaced|automated|ditched|signed|onboarded|coached|saved|landed)\b/i;
/** A timespan that makes a first-person sentence a record of what happened: "last quarter we". */
const TIMESPAN = /\b(?:last|this|past|previous)\s+(?:quarter|month|year|week|season)\b/i;
/** Someone else did a particular thing: "a client told me", "one founder asked". */
const OTHERS_EVENT = /\b(?:a|an|one|my|our|the)\s+(?:client|customer|founder|student|member|team|colleague|friend|reader|partner)s?\s+(?:told|said|asked|wrote|messaged|texted|emailed|admitted|confessed|replied|called|thanked)\b/i;
/** Words that show a quoted line is someone's words. */
const SPEAKER = /\b(client|customer|founder|student|member|someone|reader|told|said|says|wrote|asked|replied|messaged|texted|feedback|testimonial|review)\b/i;
/** A capitalised name ending in a method word: "3-Q Review", "Sales Process". */
const METHOD = /\b((?:[A-Z0-9][\w'’-]*\s+){0,3}[A-Z0-9][\w'’-]*)\s+(Review|Method|Framework|System|Process|Audit|Sprint|Playbook|Formula|Matrix|Protocol|Canvas|Ladder|Loop|Blueprint|Scorecard|Checklist|Model|Cycle)\b/g;
/** Words that can open a capitalised phrase without being part of its name. */
const DETERMINERS = new Set(["the", "a", "an", "our", "my", "this", "that", "your", "their", "his", "her", "its", "one", "two", "three", "every", "each"]);

const SHINGLE = 4;

const tokens = (s: string): string[] => s.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? [];

function shingles(words: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE <= words.length; i++) out.add(words.slice(i, i + SHINGLE).join(" "));
  return out;
}

/** The numbers a text states: digits (commas dropped) and count words. */
function quantities(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.add(m[0].replace(/,/g, "").replace(/\.0+$/, ""));
  for (const w of tokens(s)) {
    const n = NUMBER_WORDS[w];
    if (n) out.add(n);
  }
  return out;
}

/** Lower case, typographic quotes and apostrophes straightened, spaces folded. */
const normText = (s: string): string =>
  s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ");

const excerptOf = (s: string): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 160 ? `${t.slice(0, 157).trimEnd()}…` : t;
};

/**
 * Every sentence of the draft that states something the brand context does not
 * back up. `grounding` is everything the draft may draw on: the brand context,
 * the person's own samples and the piece's topic.
 */
export function unsupportedClaims(draft: string, grounding: string): UnsupportedClaim[] {
  const text = draft.replace(/^\s*\d+\/\s*/gm, "").trim();
  if (!text) return [];
  const groundNorm = normText(grounding);
  const groundNums = quantities(grounding);
  const groundShingles = shingles(tokens(grounding));
  /** True when the sentence's words run on from the brand context: copied, not invented. */
  const grounded = (s: string) => {
    for (const sh of shingles(tokens(s))) if (groundShingles.has(sh)) return true;
    return false;
  };

  const out: UnsupportedClaim[] = [];
  const seen = new Set<string>();
  const add = (kind: ClaimKind, excerpt: string) => {
    const key = `${kind}|${excerpt}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, excerpt: excerptOf(excerpt) });
  };

  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

  for (const s of sentences) {
    const first = FIRST_PERSON.test(s);
    const timed = first && TIMESPAN.test(s);
    if ((EVENT.test(s) || timed || OTHERS_EVENT.test(s)) && !grounded(s)) add("event", s);

    const draftNums = quantities(s);
    const numbered = first || MONEY_OR_PERCENT.test(s);
    if (numbered && [...draftNums].some((n) => !groundNums.has(n))) add("number", s);
  }

  // Quoted lines: checked across the whole text, since a quote can run past a sentence stop.
  for (const m of text.matchAll(/[“"]([^“”"\n]{4,})[”"]/g)) {
    const quote = m[1].trim();
    const q = normText(quote);
    if (groundNorm.includes(q)) continue;
    const sentence = sentences.find((s) => s.includes(quote)) ?? quote;
    if (grounded(sentence)) continue;
    if (SPEAKER.test(sentence) || /\d/.test(quote)) add("quote", `“${quote}”`);
  }

  for (const m of text.matchAll(METHOD)) {
    const words = m[1].split(/\s+/);
    while (words.length && DETERMINERS.has(words[0].toLowerCase())) words.shift();
    if (!words.length) continue;
    const name = `${words.join(" ")} ${m[2]}`;
    if (groundNorm.includes(normText(name))) continue;
    if (grounded(m[0])) continue;
    add("method", m[0].trim());
  }

  return out;
}

/** The message a finding shows for each kind, in the words of the person it is shown to. */
export const CLAIM_MESSAGE: Record<ClaimKind, string> = {
  number: "This states a number your brand context does not contain. Use a figure from your proof, or cut it.",
  quote: "This quotes someone your brand context does not contain. Only use a real quote you have.",
  event: "This says something happened that your brand context does not record. Make it an opinion, or add the real story to your brand first.",
  method: "This names a method your brand context does not name. Use one you have, or cut the name.",
};
