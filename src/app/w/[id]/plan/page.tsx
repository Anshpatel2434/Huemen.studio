import { redirect } from "next/navigation";

/** Plan opens on the idea inbox. */
export default async function PlanIndex({ params }: PageProps<"/w/[id]/plan">) {
  const { id } = await params;
  redirect(`/w/${id}/plan/ideas`);
}
