import { redirect } from "next/navigation";

/**
 * Moved in build step 3: this belongs to the whole workspace now, not to one
 * piece. Kept as a redirect so old links and bookmarks still land.
 */
export default async function Moved({ params }: PageProps<"/w/[id]/p/[pid]/ideas">) {
  const { id } = await params;
  redirect(`/w/${id}/plan/ideas`);
}
