import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/auth/types";
import { WorkspaceShell } from "@/components/workspace-shell";

export const dynamic = "force-dynamic";

/**
 * Settings, in the app shell (§14): the sidebar stays, so there is no separate
 * "Back" any more; the account pages are the section's tabs. Settings belong
 * to the person, so the shell shows their own workspace.
 */
export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const session = await getSession();
  if (!session) redirect("/login");
  const tabs = [
    { href: "/settings", label: "Account", exact: true },
    { href: "/settings/connections", label: "Connections" },
    { href: "/settings/usage", label: "AI usage" },
    ...(isPlatformAdmin(session.role) ? [{ href: "/settings/workspaces", label: "Workspaces & access" }] : []),
  ];
  return (
    <WorkspaceShell tenantId={session.tenantId} section="Settings" tabs={tabs}>
      <div className="absolute inset-0 overflow-y-auto">
        <div className="max-w-[680px] mx-auto px-5 min-[900px]:px-8 py-10">{children}</div>
      </div>
    </WorkspaceShell>
  );
}
