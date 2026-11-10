/**
 * POST /w/[id]/onboarding/extract — one PDF or Word file in, its words out.
 *
 * A route rather than a server action for the same reason as transcribe: a
 * document outgrows a server action's body limit. The page sends the file
 * ahead to storage (lib/upload-client) and posts { key, name }; it is read
 * back, removed, and only the text comes back, to be added like a paste. A
 * multipart file is still accepted, for files under the host's body limit.
 */
import { getSession } from "@/lib/auth";
import { resolveScope } from "@/lib/auth/scope";
import { documentText, DOCUMENT_MAX_BYTES } from "@/lib/voice/documents";
import { takeIncoming } from "@/lib/storage/upload";

export async function POST(req: Request, ctx: RouteContext<"/w/[id]/onboarding/extract">) {
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in again to upload." }, { status: 401 });
  try {
    await resolveScope(session, id);
  } catch {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (Number(req.headers.get("content-length") ?? 0) > DOCUMENT_MAX_BYTES + 64 * 1024) {
    return Response.json({ error: "That file is over 10 MB. Split it, or paste the text." }, { status: 413 });
  }
  let name: string;
  let bytes: Uint8Array | null;
  if (req.headers.get("content-type")?.startsWith("application/json")) {
    const body = (await req.json().catch(() => null)) as { key?: unknown; name?: unknown } | null;
    name = String(body?.name ?? "");
    bytes = await takeIncoming(id, body?.key, "document");
  } else {
    const file = (await req.formData().catch(() => null))?.get("file");
    name = file instanceof File ? file.name : "";
    bytes = file instanceof File && file.size <= DOCUMENT_MAX_BYTES ? new Uint8Array(await file.arrayBuffer()) : null;
    if (file instanceof File && file.size > DOCUMENT_MAX_BYTES) return Response.json({ error: "That file is over 10 MB. Split it, or paste the text." }, { status: 413 });
  }
  if (!bytes || bytes.byteLength === 0) return Response.json({ error: "No file arrived. Try again." }, { status: 400 });

  try {
    const text = await documentText(name, bytes);
    return Response.json({ text });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "That file couldn't be read." }, { status: 422 });
  }
}
