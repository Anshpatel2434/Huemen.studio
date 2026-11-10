/**
 * POST /w/[id]/p/[pid]/content/stream — a draft written live onto the canvas
 * (brief §07: stream anything the user waits on).
 *
 * Body: { format, topic, pillarId }. Response: newline-delimited JSON, one
 * event per line:
 *   {"t":"d","v":"text"}          a piece of the draft as it is written
 *   {"t":"saved","id":"<uuid>"}   the piece is stored; open it
 *   {"t":"error","message":"…"}   a plain message for the person (never "AI")
 *
 * Same access rules as every workspace page (resolveScope + RLS); no access
 * is a 404, never a stream.
 */
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { resolveScope } from "@/lib/auth/scope";
import { getProject, unlockStage, type ProjectScope } from "@/lib/data/projects";
import { streamContent } from "@/lib/data/content";
import { scoreProject } from "@/lib/data/check";
import { userMessage } from "@/lib/ai/errors";
import { FORMATS } from "@/lib/content/formats";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: RouteContext<"/w/[id]/p/[pid]/content/stream">) {
  const { id, pid } = await ctx.params;
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  let scope: ProjectScope;
  try {
    const ws = { ...(await resolveScope(session, id)), tenantId: id, isPlatformAdmin: false };
    if (!(await getProject(ws, pid))) throw new Error("no project");
    scope = { ...ws, projectId: pid };
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { format?: string; topic?: string; pillarId?: string | null };
  const format = FORMATS.some((f) => f.key === body.format) ? body.format! : "linkedin_post";
  const input = { format, topic: String(body.topic ?? "").slice(0, 400), pillarId: body.pillarId || null };

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
      try {
        for await (const ev of streamContent(scope, input)) {
          if (ev.type === "delta") send({ t: "d", v: ev.text });
          else {
            await unlockStage(scope, "content").catch(() => undefined);
            await scoreProject(scope).catch(() => undefined);
            revalidatePath(`/w/${id}/p/${pid}`, "layout");
            send({ t: "saved", id: ev.id });
          }
        }
      } catch (e) {
        send({ t: "error", message: userMessage(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
