/**
 * POST /w/[id]/p/[pid]/content/stream — a draft written live onto the canvas
 * (brief §07: stream anything the user waits on).
 *
 * Body: { format, topic, pillarId }. Response: newline-delimited JSON, one
 * event per line:
 *   {"t":"notice","message":"…"}  something the person should know (the topic was cut)
 *   {"t":"d","v":"text"}          a piece of the draft as it is written
 *   {"t":"r","v":"text"}          the whole draft, replacing what was written so far
 *                                 (a draft that came back in the wrong shape is written again)
 *   {"t":"saved","id":"<uuid>"}   the piece is stored; open it
 *   {"t":"error","message":"…"}   a plain message for the person (never "AI")
 *
 * Same access rules as every workspace page (resolveScope + RLS); no access
 * is a 404, never a stream.
 *
 * ONE RULE FOR A READER WHO LEAVES. Once a draft has started, it is finished
 * and saved whether or not anyone is still watching: closing the tab,
 * reloading and navigating away all end the same way, with the whole draft on
 * the piece when they come back. (Before, a reload happened to finish and
 * save it while moving to another page threw it away, both without a word.)
 * The model call is paid for either way, so keeping the words is the safe
 * choice; the Content step says on return that the draft finished while they
 * were away (components/live-draft). "Stop writing" is the one way to throw a
 * draft away, and the page does that itself by deleting the piece it is told
 * was saved.
 */
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getSession } from "@/lib/auth";
import { resolveScope } from "@/lib/auth/scope";
import { getProject, unlockStage, type ProjectRow, type ProjectScope } from "@/lib/data/projects";
import { streamContent, TOPIC_MAX } from "@/lib/data/content";
import { scoreProject } from "@/lib/data/check";
import { userMessage } from "@/lib/ai/errors";
import { FORMATS } from "@/lib/content/formats";
import { uuidOrNull } from "@/lib/content/ids";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: RouteContext<"/w/[id]/p/[pid]/content/stream">) {
  const { id, pid } = await ctx.params;
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  let scope: ProjectScope;
  let project: ProjectRow;
  try {
    const ws = { ...(await resolveScope(session, id)), tenantId: id, isPlatformAdmin: false };
    const found = await getProject(ws, pid);
    if (!found) throw new Error("no project");
    project = found;
    scope = { ...ws, projectId: pid };
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { format?: string; topic?: string; pillarId?: string | null };
  const format = FORMATS.some((f) => f.key === body.format) ? body.format! : "linkedin_post";
  // The whole topic is the task input (the project NAME is what gets cut short).
  // A pillar id that isn't one is dropped; the angle is the piece's own, read
  // here rather than taken from the browser.
  const topicIn = String(body.topic ?? "");
  const topicCut = topicIn.length > TOPIC_MAX;
  const input = { format, topic: topicIn.slice(0, TOPIC_MAX), pillarId: uuidOrNull(body.pillarId), angle: project.angle };

  const enc = new TextEncoder();
  let finished: () => void = () => {};
  const done = new Promise<void>((resolve) => { finished = resolve; });
  // Keep the function alive until the draft is saved, even after the reader
  // has gone (see the rule above). Outside a request (tests) there is nothing to hold.
  try { after(() => done); } catch { /* no request scope */ }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      // A reader who has left closes the stream; writing to it then throws.
      // That must not stop the draft, so a failed write only marks them gone.
      const send = (o: unknown) => {
        if (!open) return;
        try { controller.enqueue(enc.encode(`${JSON.stringify(o)}\n`)); } catch { open = false; }
      };
      try {
        if (topicCut) send({ t: "notice", message: `The topic is longer than ${TOPIC_MAX} characters, so the draft uses only the first ${TOPIC_MAX}.` });
        for await (const ev of streamContent(scope, input)) {
          if (ev.type === "delta") send({ t: "d", v: ev.text });
          else if (ev.type === "replace") send({ t: "r", v: ev.text });
          else {
            await unlockStage(scope, "content").catch(() => undefined);
            await scoreProject(scope).catch(() => undefined);
            try { revalidatePath(`/w/${id}/p/${pid}`, "layout"); } catch { /* no request scope */ }
            send({ t: "saved", id: ev.id });
          }
        }
      } catch (e) {
        send({ t: "error", message: userMessage(e) });
      } finally {
        finished();
        try { controller.close(); } catch { /* already closed by the reader */ }
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
