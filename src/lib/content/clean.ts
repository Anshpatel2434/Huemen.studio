/**
 * The one clean-up for text a model wrote, before it is shown or stored.
 *
 * Models reach for typographic characters the person never types: the
 * non-breaking hyphen (U+2011), the "real" hyphen (U+2010), non-breaking and
 * narrow spaces. They look right and then break search, the brand check's
 * word counts and copy-paste into LinkedIn. They are replaced with what a
 * keyboard produces. When the person's voice has no em dashes (measured, or
 * their own rule: BrandContext.writing.noEmDash), em dashes are taken out
 * too, so that rule holds even when a model ignores it.
 *
 * Every path that keeps or streams model text goes through here: the facade
 * (lib/ai) applies it to drafts, streamed drafts and task answers, so no
 * feature has to remember to. Pure: no I/O.
 */

export interface CleanOptions {
  /** Replace em dashes: the voice does not use them. */
  noEmDash?: boolean;
}

const HYPHENS = /[‐‑]/g;
/** No-break space, narrow no-break space, figure space, thin space, hair space. */
const SPACES = /[     ]/g;
/** Zero-width characters and the byte-order mark: invisible, never wanted. */
const INVISIBLE = /[​‌‍⁠﻿]/g;

/** One-for-one replacements: safe on any fragment, never change the length of a word. */
function plainChars(text: string): string {
  return text.replace(HYPHENS, "-").replace(SPACES, " ").replace(INVISIBLE, "");
}

/**
 * An em dash between words becomes a comma; one that opens a line (a list or
 * a quote attribution) becomes a hyphen; one before closing punctuation or at
 * the end of a line goes.
 */
function withoutEmDash(text: string): string {
  return text
    .replace(/^([ \t]*)—[ \t]*/gm, "$1- ")
    .replace(/[ \t]*—[ \t]*(?=[.,;:!?)\]"'”’]|$)/gm, "")
    .replace(/[ \t]*—[ \t]*/g, ", ");
}

export function cleanModelText(text: string, opts: CleanOptions = {}): string {
  const plain = plainChars(text);
  return opts.noEmDash ? withoutEmDash(plain) : plain;
}

/**
 * The same clean-up for text that arrives in pieces. The one-for-one
 * replacements apply to each piece as it comes. An em dash needs the spaces
 * on both sides of it, which can arrive in different pieces, so the end of
 * each piece is held back from its last line break, space or dash until the
 * next piece (or `flush`) settles it. Joined, the output equals
 * `cleanModelText` of the whole text.
 */
export function streamCleaner(opts: CleanOptions = {}): { push: (delta: string) => string; flush: () => string } {
  if (!opts.noEmDash) return { push: plainChars, flush: () => "" };
  let held = "";
  let lineStart = true;
  const emit = (chunk: string): string => {
    if (!chunk) return "";
    // A dash that opens a line needs to know it does: carry that across pieces.
    const out = withoutEmDash(lineStart ? chunk : `x${chunk}`).slice(lineStart ? 0 : 1);
    lineStart = /\n[ \t]*$/.test(chunk) || (lineStart && /^[ \t]*$/.test(chunk));
    return out;
  };
  return {
    push(delta) {
      const text = held + plainChars(delta);
      // Hold the trailing run of spaces and dashes, and one character after
      // them if the piece ends right there: the rule looks one ahead.
      const cut = text.search(/[ \t—]*$/);
      held = text.slice(cut);
      return emit(text.slice(0, cut));
    },
    flush() {
      const rest = held;
      held = "";
      return emit(rest);
    },
  };
}

/**
 * Markdown emphasis taken out of text that goes INTO A PICTURE (a headline, a
 * slide line, a caption drawn on an image). The stored copy keeps it: WhatsApp
 * and Slack read *bold*, _italic_ and ~strike~ as formatting, and the copy is
 * right for them. A picture has no formatter, so the markers print as
 * asterisks. Only the visual rendering calls this; the words are unchanged.
 *
 * A marker counts only when it wraps a word (no space just inside it, and it
 * starts or ends at a word edge), so "3 * 4 * 5" and snake_case_names survive.
 */
export function visualText(text: string): string {
  const open = String.raw`(^|[\s(\[{"'“‘—-])`;
  const close = String.raw`(?=$|[\s)\]}.,;:!?"'”’—-])`;
  return text
    .replace(/\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g, "$1")
    .replace(/__(?=\S)([^_\n]+?)(?<=\S)__/g, "$1")
    .replace(new RegExp(`${open}\\*(?=\\S)([^*\\n]+?)(?<=\\S)\\*${close}`, "gu"), "$1$2")
    .replace(new RegExp(`${open}_(?=\\S)([^_\\n]+?)(?<=\\S)_${close}`, "gu"), "$1$2")
    .replace(new RegExp(`${open}~(?=\\S)([^~\\n]+?)(?<=\\S)~${close}`, "gu"), "$1$2");
}

/**
 * Clean every string inside a task's answer (lib/ai/tasks), leaving the named
 * fields alone: a field that QUOTES the input (the judge's `line`) has to stay
 * character for character what the person wrote, or it can't be found again.
 */
export function cleanDeep<T>(value: T, opts: CleanOptions = {}, verbatim: readonly string[] = []): T {
  if (typeof value === "string") return cleanModelText(value, opts) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => cleanDeep(v, opts, verbatim)) as unknown as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, verbatim.includes(k) ? v : cleanDeep(v, opts, verbatim)]),
    ) as T;
  }
  return value;
}
