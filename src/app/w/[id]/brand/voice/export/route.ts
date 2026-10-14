/**
 * GET /w/[id]/brand/voice/export?file=VOICE.md|identity.md|…|voice.json|all
 * The Voice Pack as the spec's eight files (lib/voice/export). Same access
 * rules as every workspace page (resolveScope + RLS); no access → 404.
 */
import { getSession } from "@/lib/auth";
import { resolveScope } from "@/lib/auth/scope";
import { listSamples, loadPackForWorkspace } from "@/lib/data/voice-pack";
import { exportVoiceFile, exportVoicePack, VOICE_FILES, type VoiceFile } from "@/lib/voice/export";

export async function GET(req: Request, ctx: RouteContext<"/w/[id]/brand/voice/export">) {
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  let scope;
  try {
    scope = { ...(await resolveScope(session, id)), tenantId: id };
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const pack = await loadPackForWorkspace(scope);
  if (!pack) return new Response("Not found", { status: 404 });
  const samples = await listSamples(scope, pack.id, { includeExcluded: true });

  const want = new URL(req.url).searchParams.get("file") ?? "all";
  const slug = (pack.displayName || "voice").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "voice";
  const file = (VOICE_FILES as readonly string[]).includes(want) ? (want as VoiceFile) : null;
  const body = file ? exportVoiceFile(file, pack, samples) : exportVoicePack(pack, samples);
  const name = file ? `${slug}-${file}` : `${slug}-voice-pack.md`;
  return new Response(body, {
    headers: {
      "Content-Type": `${file === "voice.json" ? "application/json" : "text/markdown"}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
