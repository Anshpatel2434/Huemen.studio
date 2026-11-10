/**
 * Real images for upload tests. Uploads are decoded and re-encoded before they
 * are stored (lib/storage/image), so a PNG signature followed by nothing is
 * refused now; tests that only need "a PNG" use this one.
 */

/** A valid 1x1 grey PNG (67 bytes). */
export const TINY_PNG = new Uint8Array(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"),
);
