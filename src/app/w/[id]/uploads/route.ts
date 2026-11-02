/**
 * POST /w/[id]/uploads — where to send a file before using it (lib/storage/upload).
 *
 * Body: { purpose: "asset" | "document" | "audio", name, size, type }. Returns
 * a key under this workspace's incoming/ prefix and the one-time addresses to
 * PUT the bytes to. Same access rules as every workspace page; the size is
 * checked here and again when the file is used.
 */
import { getSession } from "@/lib/auth";
import { resolveScope } from "@/lib/auth/scope";
import { UPLOAD_LIMITS, UploadError, uploadTarget, type UploadPurpose } from "@/lib/storage/upload";

export async function POST(req: Request, ctx: RouteContext<"/w/[id]/uploads">) {
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in again to upload." }, { status: 401 });
  try {
    await resolveScope(session, id);
  } catch {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as { purpose?: string; name?: unknown; size?: unknown; type?: unknown } | null;
  const purpose = body?.purpose;
  if (!purpose || !(purpose in UPLOAD_LIMITS)) return Response.json({ error: "Unknown upload." }, { status: 400 });
  try {
    const target = await uploadTarget(id, purpose as UploadPurpose, String(body?.name ?? "file"), Number(body?.size), String(body?.type ?? ""));
    return Response.json(target);
  } catch (e) {
    if (e instanceof UploadError) return Response.json({ error: e.message }, { status: 413 });
    throw e;
  }
}
