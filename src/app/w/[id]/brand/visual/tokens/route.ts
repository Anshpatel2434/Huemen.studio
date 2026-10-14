import { workspaceScope } from "@/lib/auth/workspace";
import { loadVisualIdentity } from "@/lib/data/foundation";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { getWorkspace } from "@/lib/data/workspaces";
import { visualTokens } from "@/lib/visual/core";

/** The Visual Core as a token file (M9): colours with their use, fonts, layout, motifs, the template kit. */
export async function GET(_req: Request, { params }: RouteContext<"/w/[id]/brand/visual/tokens">) {
  const { id } = await params;
  const { scope } = await workspaceScope(id);
  const [visual, pack, ws] = await Promise.all([loadVisualIdentity(scope), loadPackForWorkspace(scope), getWorkspace(scope)]);
  const tokens = visualTokens({
    brand: pack?.displayName || ws?.name || "Brand",
    palette: visual.palette,
    fonts: visual.fonts,
    imageStyleNotes: visual.imageStyleNotes,
    core: visual.core ?? {},
  });
  return new Response(JSON.stringify(tokens, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="visual-core.json"` },
  });
}
