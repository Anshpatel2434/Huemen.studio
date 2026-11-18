"use client";

/**
 * Templated visuals leave the app as real files (brief §4.3: "download at
 * correct per-channel export dimensions"). An artboard is rendered in the
 * browser, so it is exported from the browser: the DOM node is drawn to a
 * canvas at the channel's pixel size and saved as a PNG. Text stays text
 * until the final raster, so it is never misspelt (brief §09) and stays
 * sharp at 1080 wide from a 300px artboard.
 *
 * html-to-image is loaded on first use, so the page itself pays nothing.
 */

/** How long an export waits for its fonts before drawing with what it has. */
const FONT_WAIT_MS = 5000;

/** The font families the node's text is set in (each family of each stack). */
function familiesIn(node: HTMLElement): string[] {
  const out = new Set<string>();
  const add = (stack: string) => stack.split(",").forEach((f) => { const n = f.trim().replace(/^["']|["']$/g, ""); if (n && !/^(serif|sans-serif|monospace|system-ui|cursive|fantasy|inherit|ui-\w+)$/i.test(n)) out.add(n); });
  add(getComputedStyle(node).fontFamily);
  node.querySelectorAll<HTMLElement>("*").forEach((el) => add(getComputedStyle(el).fontFamily));
  return [...out];
}

/**
 * Every face the node uses, loaded before it is drawn: a brand font from an
 * upload or Google (lib/visual/fonts) loads on first use, and a capture taken
 * before it arrives draws the fallback. Never blocks the export for long.
 */
export async function fontsReady(node: HTMLElement): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const loads = familiesIn(node).map((f) => document.fonts.load(`16px "${f.replace(/"/g, "")}"`, node.textContent?.slice(0, 200) || " ").catch(() => []));
  await Promise.race([
    Promise.all(loads).then(() => document.fonts.ready),
    new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS)),
  ]);
}

export async function nodeToPngBlob(node: HTMLElement, width: number, height: number): Promise<Blob> {
  const { toBlob } = await import("html-to-image");
  await fontsReady(node);
  // Fonts: html-to-image embeds every @font-face rule the node uses, read from
  // the document's stylesheets: the house faces (public/fonts), an uploaded
  // brand font (a same-origin signed link) and Google's (its sheet is loaded
  // with CORS, so its rules are readable). Scale to the
  // exact channel size rather than a pixel ratio, so the file is 1080×1350,
  // not 1080×1349 from a rounded aspect ratio.
  const blob = await toBlob(node, {
    canvasWidth: width,
    canvasHeight: height,
    pixelRatio: 1,
    cacheBust: false,
    // The artboard is light in both themes (`theme-light` on the board), so
    // a dark app theme never leaks into the file.
    backgroundColor: undefined,
  });
  if (!blob) throw new Error("Nothing rendered");
  // Always a PNG-typed blob: the browser keeps the type it is given.
  return blob.type === "image/png" ? blob : new Blob([blob], { type: "image/png" });
}

/**
 * Save a file under a name the person sees in Downloads. The name is given on
 * the File itself as well as on the link, and the type follows the name (a
 * .png is image/png), so the browser never falls back to a generic type or a
 * temporary name. The object URL lives for a minute: the browser reads the blob
 * after the click, and a URL revoked a second later could lose the download.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const type = /\.png$/i.test(filename) ? "image/png" : blob.type || "application/octet-stream";
  const file = new File([blob], filename, { type });
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Several PNGs as one zip (a carousel's frames), so one click gives one file. */
export async function zipBlobs(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const { zipSync } = await import("fflate");
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.name] = new Uint8Array(await f.blob.arrayBuffer());
  // PNGs are already compressed; store them as-is.
  const out = zipSync(entries, { level: 0 });
  return new Blob([out as BlobPart], { type: "application/zip" });
}

/** A filename-safe slug; the naming of exported visuals lives in lib/visual/export. */
export { fileSlug } from "@/lib/visual/export";
