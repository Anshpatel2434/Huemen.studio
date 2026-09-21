import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Home = your workspace's projects. Admins/coaches switch workspaces from its sidebar. */
export default async function DashboardHome() {
  const session = await getSession();
  if (!session) redirect("/login");
  redirect(`/w/${session.tenantId}`);
}
