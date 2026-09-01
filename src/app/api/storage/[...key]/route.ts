/**
 * Serves stored objects behind a short-lived, scoped signed URL (INV-1, §07).
 * The signature (HMAC over key+expiry) is the authorisation: no valid token →
 * no bytes. Keys are tenant-prefixed, so a token only unlocks one tenant's file.
 */
import { NextRequest } from "next/server";
import { storage, verifySignature } from "@/lib/storage";

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

  return new Response(obj.data as BodyInit, {
    headers: {
      "Content-Type": obj.mime,
      "Cache-Control": "private, max-age=60",
    },
  });
}
