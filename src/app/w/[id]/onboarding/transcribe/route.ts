/**
 * POST /w/[id]/onboarding/transcribe — one recorded voice note in, its text out.
 *
 * A route rather than a server action because audio outgrows a server action's
 * default body limit. Same access rules as every workspace page (resolveScope,
 * then RLS for the log row). The recorder sends the audio ahead to storage
 * (lib/upload-client) and posts { key, name, type }; it is read back, removed,
 * and passed to the transcriber. Only the text comes back, for the person to
 * read and keep. A multipart "audio" field is still accepted.
 */
import { getSession } from "@/lib/auth";
import { resolveScope } from "@/lib/auth/scope";
import { transcribe } from "@/lib/ai";
import { userMessage } from "@/lib/ai/errors";
import { takeIncoming, UPLOAD_LIMITS } from "@/lib/storage/upload";

/** About ten minutes of compressed speech. A two-minute note is well under. */
const MAX_BYTES = UPLOAD_LIMITS.audio;

export async function POST(req: Request, ctx: RouteContext<"/w/[id]/onboarding/transcribe">) {
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in again to record." }, { status: 401 });
  let scope;
  try {
    scope = { ...(await resolveScope(session, id)), tenantId: id, isPlatformAdmin: false };
  } catch {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Refuse an oversized body before reading it (a direct upload sends only a key).
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES + 64 * 1024) {
    return Response.json({ error: "That recording is too long. Keep it to a few minutes." }, { status: 413 });
  }
  let audio: Blob | null = null;
  let name = "note.webm";
  if (req.headers.get("content-type")?.startsWith("application/json")) {
    const body = (await req.json().catch(() => null)) as { key?: unknown; name?: unknown; type?: unknown } | null;
    const bytes = await takeIncoming(id, body?.key, "audio");
    const type = typeof body?.type === "string" && /^audio\/[\w.+-]+(;.*)?$/.test(body.type) ? body.type : "audio/webm";
    if (bytes) audio = new Blob([bytes as BlobPart], { type });
    if (typeof body?.name === "string" && /^[\w.-]{1,40}$/.test(body.name)) name = body.name;
  } else {
    const field = (await req.formData().catch(() => null))?.get("audio");
    if (field instanceof Blob) audio = field;
    if (field instanceof File && field.name) name = field.name;
  }
  if (!audio || audio.size === 0) return Response.json({ error: "No recording arrived. Try again." }, { status: 400 });
  if (audio.size > MAX_BYTES) return Response.json({ error: "That recording is too long. Keep it to a few minutes." }, { status: 413 });

  try {
    const text = await transcribe(scope, audio, name);
    return Response.json({ text });
  } catch (e) {
    return Response.json({ error: userMessage(e) }, { status: 502 });
  }
}
