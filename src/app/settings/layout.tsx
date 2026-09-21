import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/auth/types";
import { ToastProvider } from "@/components/ui";
import { SettingsNav } from "./nav";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <ToastProvider>
      <div className="h-screen flex flex-col">
        <SettingsNav isAdmin={isPlatformAdmin(session.role)} home={session.role === "client" ? `/w/${session.tenantId}` : "/dashboard"}>
          {children}
        </SettingsNav>
      </div>
    </ToastProvider>
  );
}
