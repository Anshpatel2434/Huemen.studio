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

export async function nodeToPngBlob(node: HTMLElement, width: number, height: number): Promise<Blob> {
  const { toBlob } = await import("html-to-image");
  // Fonts: next/font serves them same-origin, so they embed. Scale to the
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
  return blob;
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the click a tick before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

/** A filename-safe slug: "The Brand Professor" → "the-brand-professor". */
export const fileSlug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "visual";
