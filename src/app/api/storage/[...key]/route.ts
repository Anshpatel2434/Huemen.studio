/**
 * Serves stored objects behind a short-lived, scoped signed URL (INV-1, §07).
 * The signature (HMAC over key+expiry) is the authorisation: no valid token →
 * no bytes. Keys are tenant-prefixed, so a token only unlocks one tenant's file.
 *
 * PUT is the upload relay (lib/storage/upload): local disk, or a small file
 * whose bucket refused the browser. Its token is a different signature, for
 * one incoming/ key and one exact size, and can't be used to read.
 */
import { NextRequest } from "next/server";
import { storage, verifySignature } from "@/lib/storage";
import { RELAY_MAX_BYTES, verifyPut } from "@/lib/storage/upload";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key: segments } = await params;
  const key = segments.map(decodeURIComponent).join("/");
  const token = req.nextUrl.searchParams.get("token") ?? "";

  if (!verifySignature(key, token)) {
    return new Response("Forbidden", { status: 403 });
  }

  const obj = await storage().get(key);
  if (!obj) return new Response("Not found", { status: 404 });

  // Locked down whatever the file is: the browser may not guess another type,
  // and a file opened on its own (an SVG, say) can run nothing and load
  // nothing. Anything that isn't an image or a font is downloaded, not shown.
  const shown = /^(image\/(png|jpeg|webp|gif|svg\+xml)|font\/)/.test(obj.mime);
  const name = key.split("/").pop() ?? "file";
  return new Response(obj.data as BodyInit, {
    headers: {
      "Content-Type": obj.mime,
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      "Content-Disposition": `${shown ? "inline" : "attachment"}; filename="${name.replace(/[^\w.-]/g, "_")}"`,
      // No Cross-Origin-Resource-Policy: links are built from APP_URL, and a
      // preview deployment's own address differs from it. The token gates access.
    },
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key: segments } = await params;
  const key = segments.map(decodeURIComponent).join("/");
  const size = /^tenants\/[0-9a-f-]{36}\/incoming\//.test(key) ? verifyPut(key, req.nextUrl.searchParams.get("put") ?? "") : null;
  if (!size) return new Response("Forbidden", { status: 403 });
  if (size > RELAY_MAX_BYTES && storage().name !== "local") return new Response("Too large to relay", { status: 413 });

  if (Number(req.headers.get("content-length") ?? size) !== size) return new Response("Size doesn't match", { status: 400 });
  const data = new Uint8Array(await req.arrayBuffer());
  if (data.byteLength !== size) return new Response("Size doesn't match", { status: 400 });
  await storage().put(key, data, "application/octet-stream");
  return new Response(null, { status: 204 });
}
