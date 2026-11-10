/**
 * What an uploaded file really is, read from its first bytes, never from the
 * name or the type the browser sent (both are the uploader's to choose). And
 * whether an SVG is safe to keep: an SVG is a document that can carry
 * scripts, so one with any active content is refused rather than cleaned.
 * Pure, so it is tested directly.
 */

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, at: number, s: string) => starts(b, [...s].map((c) => c.charCodeAt(0)), at);

/** The file's real type, or null when it is none we know. */
export function sniffType(b: Uint8Array): string | null {
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) return "image/webp";
  if (ascii(b, 0, "GIF87a") || ascii(b, 0, "GIF89a")) return "image/gif";
  if (ascii(b, 0, "%PDF-")) return "application/pdf";
  if (starts(b, [0x50, 0x4b, 0x03, 0x04])) return "application/zip"; // .docx, .xlsx, ...
  if (ascii(b, 0, "wOFF")) return "font/woff";
  if (ascii(b, 0, "wOF2")) return "font/woff2";
  if (ascii(b, 0, "OTTO")) return "font/otf";
  if (starts(b, [0x00, 0x01, 0x00, 0x00]) || ascii(b, 0, "true")) return "font/ttf";
  // SVG is text: an optional BOM, XML prolog, comments or doctype, then <svg.
  const head = new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, 4096)).replace(/^﻿/, "");
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(head)) return "image/svg+xml";
  return null;
}

/** Why an SVG can't be kept, or null when it has no active content. */
export function svgProblem(b: Uint8Array): string | null {
  const svg = new TextDecoder("utf-8", { fatal: false }).decode(b);
  if (/<script[\s>]/i.test(svg)) return "it contains a script";
  if (/<foreignObject[\s>]/i.test(svg)) return "it embeds HTML (foreignObject)";
  if (/\son[a-z]+\s*=/i.test(svg)) return "it has event handlers (onload, onclick, ...)";
  if (/(href|src)\s*=\s*["']\s*(javascript|vbscript|data:text\/html)/i.test(svg) || /url\(\s*["']?\s*javascript:/i.test(svg)) return "it links to script";
  if (/<!ENTITY/i.test(svg)) return "it declares XML entities";
  if (/(href|src)\s*=\s*["']\s*(https?:)?\/\//i.test(svg) || /@import/i.test(svg)) return "it loads files from elsewhere";
  return null;
}
