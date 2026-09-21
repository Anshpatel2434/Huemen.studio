import { redirect } from "next/navigation";
import { projectScope } from "@/lib/auth/workspace";
import { loadBrandContext } from "@/lib/context/context-loader";

export const dynamic = "force-dynamic";

/** Open a project where the work is: empty brief → intake, else the furthest unlocked step. */
export default async function ProjectIndex({ params }: PageProps<"/w/[id]/p/[pid]">) {
  const { id, pid } = await params;
  const { scope, project } = await projectScope(id, pid);
  const ctx = await loadBrandContext(scope);
  const base = `/w/${id}/p/${pid}`;
  if (ctx.completeness === 0) redirect(`${base}/intake`);
  redirect(project.stage === "brief" ? `${base}/brief` : `${base}/${project.stage}`);
}
