/**
 * Text out of the documents people actually keep their writing in: PDF and
 * Word (.docx). Server-only: PDF parsing is too heavy for the browser bundle.
 *
 * Only the words come out. Layout, images and comments are dropped, and the
 * text then goes through the same `ingestText` as a paste.
 */
import "server-only";
import { unzipSync, strFromU8 } from "fflate";

export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

/** word/document.xml → paragraphs. Tabs and breaks kept; tracked deletions dropped. */
export function docxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
  const xml = files["word/document.xml"];
  if (!xml) throw new Error("That doesn't look like a Word document.");
  const body = strFromU8(xml).replace(/<w:del\b[\s\S]*?<\/w:del>/g, "");
  return body
    .split(/<\/w:p>/)
    .map((p) =>
      decodeXml(
        p.replace(/<w:tab\/>/g, "\t").replace(/<w:br\/>/g, "\n")
          .replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g, "\u0000$1\u0000")
          .split("\u0000").filter((_, i) => i % 2 === 1).join(""),
      ).trim(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  // Pages become paragraphs; hyphenated line-ends are rejoined.
  return (Array.isArray(text) ? text : [text])
    .map((t) => t.replace(/-\n(\p{Ll})/gu, "$1").replace(/[ \t]+\n/g, "\n").trim())
    .filter(Boolean)
    .join("\n\n");
}

/** A file's words, by extension. Throws a message fit to show the person. */
export async function documentText(name: string, bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength > DOCUMENT_MAX_BYTES) throw new Error("That file is over 10 MB. Split it, or paste the text.");
  const ext = name.toLowerCase().split(".").pop();
  const text = ext === "pdf" ? await pdfText(bytes) : ext === "docx" ? docxText(bytes) : null;
  if (text === null) throw new Error("Only PDF and Word (.docx) files are read here.");
  if (!text.trim()) throw new Error(ext === "pdf" ? "No text found. A scanned PDF is an image; paste the text instead." : "No text found in that document.");
  return text;
}
