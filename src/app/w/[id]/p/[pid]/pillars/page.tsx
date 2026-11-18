import { redirect } from "next/navigation";
import { projectScope } from "@/lib/auth/workspace";

export const metadata = { title: "Pillars" };

/**
 * Moved in build step 3: this belongs to the whole workspace now, not to one
 * piece. Kept as a redirect so old links and bookmarks still land.
 *
 * Only for a project that is really there for this person: a missing or
 * another workspace's project is a 404 (projectScope calls notFound(), as the
 * project layout does), never a redirect to a Pillars page that answers 200.
 */
export default async function Moved({ params }: PageProps<"/w/[id]/p/[pid]/pillars">) {
  const { id, pid } = await params;
  await projectScope(id, pid);
  redirect(`/w/${id}/brand/pillars`);
}
