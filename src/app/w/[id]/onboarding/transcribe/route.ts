/**
 * POST /w/[id]/onboarding/transcribe — one recorded voice note in, its text out.
 *
 * A route rather than a server action because audio outgrows a server action's
 * default body limit. Same access rules as every workspace page (resolveScope,
 * then RLS for the log row). The audio is passed straight to the transcriber
 * and never stored; only the text comes back, for the person to read and keep.
 */
import { getSession } from "@/lib/auth";
import { resolveScope } from "@/lib/auth/scope";
import { transcribe } from "@/lib/ai";
import { userMessage } from "@/lib/ai/errors";

/** About ten minutes of compressed speech. A two-minute note is well under. */
const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(req: Request, ctx: RouteContext<"/w/[id]/onboarding/transcribe">) {
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in again to record." }, { status: 401 });
  let scope;
  try {
    scope = { ...(await resolveScope(session, id)), tenantId: id };
  } catch {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return Response.json({ error: "No recording arrived. Try again." }, { status: 400 });
  if (audio.size > MAX_BYTES) return Response.json({ error: "That recording is too long. Keep it to a few minutes." }, { status: 413 });

  try {
    const name = audio instanceof File && audio.name ? audio.name : "note.webm";
    const text = await transcribe(scope, audio, name);
    return Response.json({ text });
  } catch (e) {
    return Response.json({ error: userMessage(e) }, { status: 502 });
  }
}
