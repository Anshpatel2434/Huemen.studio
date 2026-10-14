/**
 * POST /w/[id]/onboarding/extract — one PDF or Word file in, its words out.
 *
 * A route rather than a server action for the same reason as transcribe: a
 * document outgrows a server action's body limit. The file is read in memory
 * and never stored; the text comes back to the page and is added like a paste.
 */
import { getSession } from "@/lib/auth";
import { resolveScope } from "@/lib/auth/scope";
import { documentText, DOCUMENT_MAX_BYTES } from "@/lib/voice/documents";

export async function POST(req: Request, ctx: RouteContext<"/w/[id]/onboarding/extract">) {
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in again to upload." }, { status: 401 });
  try {
    await resolveScope(session, id);
  } catch {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "No file arrived. Try again." }, { status: 400 });
  if (file.size > DOCUMENT_MAX_BYTES) return Response.json({ error: "That file is over 10 MB. Split it, or paste the text." }, { status: 413 });

  try {
    const text = await documentText(file.name, new Uint8Array(await file.arrayBuffer()));
    return Response.json({ text });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "That file couldn't be read." }, { status: 422 });
  }
}
