/**
 * POST /w/[id]/p/[pid]/agent/stream — an "Ask Huemen…" answer, written live as
 * cards and buttons (lib/agent-ui). The commands the panel already knows
 * (draft, add pillar, capture idea) never come here; everything else does.
 *
 * Body: { message, earlier }. Response: newline-delimited JSON, one event per
 * line, like the draft stream:
 *   {"t":"d","v":"text"}          a piece of the answer (OpenUI Lang) as it is written
 *   {"t":"done","ok":true}        finished; ok is false when it did not parse into an answer
 *   {"t":"error","message":"…"}   a plain message for the person (never "AI")
 *
 * Same access rules as every workspace page (resolveScope + RLS); no access is
 * a 404, never a stream. The answer is grounded the one way every generation
 * is (INV-2): template + brand context + task, through the facade, logged.
 */
import { getSession } from "@/lib/auth";
import { resolveScope } from "@/lib/auth/scope";
import { getProject, type ProjectScope } from "@/lib/data/projects";
import { loadBrandContext } from "@/lib/context/context-loader";
import { streamText } from "@/lib/ai";
import { resolveTemplate } from "@/lib/ai/templates";
import { userMessage } from "@/lib/ai/errors";
import { AGENT_CONTRACT, AGENT_TEMPLATE_KEY, agentSpec, agentTask, answerErrors } from "@/lib/agent-ui/prompt";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: RouteContext<"/w/[id]/p/[pid]/agent/stream">) {
  const { id, pid } = await ctx.params;
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  let scope: ProjectScope;
  let project: Awaited<ReturnType<typeof getProject>>;
  try {
    const ws = { ...(await resolveScope(session, id)), tenantId: id, isPlatformAdmin: false };
    project = await getProject(ws, pid);
    if (!project) throw new Error("no project");
    scope = { ...ws, projectId: pid };
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { message?: unknown; earlier?: unknown };
  const question = String(body.message ?? "").trim().slice(0, 500);
  if (!question) return new Response("Empty question", { status: 400 });
  const earlier = (Array.isArray(body.earlier) ? body.earlier : []).map((q) => String(q).slice(0, 200)).filter(Boolean).slice(-4);

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
      try {
        const context = await loadBrandContext(scope);
        const template = await resolveTemplate(scope, AGENT_TEMPLATE_KEY);
        const taskInput = agentTask({
          question,
          earlier,
          project: project ? { name: project.name, stage: project.stage } : null,
          completeness: context.completeness,
          warnings: context.warnings,
        });
        for await (const ev of streamText(scope, {
          templateKey: AGENT_TEMPLATE_KEY,
          systemTemplate: template.body,
          context,
          taskInput,
          route: "strong",
          variants: 1,
          contract: AGENT_CONTRACT,
          systemContract: agentSpec(),
        })) {
          if (ev.type === "delta") send({ t: "d", v: ev.text });
          else {
            const check = answerErrors(ev.text);
            const ok = check.hasRoot;
            // Structured, on stdout: a malformed answer is a quality signal, not a server error.
            if (!ok || check.errors.length) console.info(JSON.stringify({ event: "agent_answer_invalid", hasRoot: check.hasRoot, errors: check.errors.map((e) => e.code), model: ev.model }));
            send({ t: "done", ok });
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
