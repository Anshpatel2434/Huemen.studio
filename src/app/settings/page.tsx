import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { withTenantSession } from "@/db/session";
import { signOutAction } from "@/app/dashboard/actions";
import { btnClass } from "@/components/btn";
import { Avatar } from "@/components/ui";
import { ThemePicker } from "@/components/theme";

export const metadata = { title: "Account" };

const ROLE = { owner_admin: "Owner / Admin", coach: "Coach", client: "Client" } as const;

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const org = (
    await withTenantSession({ tenantId: session.tenantId, userId: session.userId, isPlatformAdmin: false }, (c) =>
      c.query<{ name: string }>("SELECT name FROM tenants WHERE id=$1", [session.tenantId]),
    )
  ).rows[0]?.name;

  return (
    <>
      <h1 className="text-3xl">Account</h1>
      <section className="mt-8 bg-paper border border-hairline rounded-md p-6">
        <p className="font-medium">Profile</p>
        <div className="mt-5 flex items-center gap-4">
          <Avatar seed={session.email} label={session.email} size="lg" square className="!w-16 !h-16 !rounded-md text-xl" />
          <div>
            <p className="text-base font-medium">{session.email}</p>
            <p className="text-sm text-ink-muted">{ROLE[session.role]} · {org}</p>
          </div>
        </div>
      </section>
      <section className="mt-4 bg-paper border border-hairline rounded-md p-6">
        <div className="bg-panel rounded-md px-4 py-3 text-sm grid grid-cols-1 sm:grid-cols-2 gap-2">
          <span className="font-medium">You joined by invite.</span>
          <span className="text-ink-muted">Email and sign-in are managed by your identity provider, not changed here.</span>
        </div>
        <label className="block mt-5">
          <span className="text-sm text-ink-muted mb-1.5 block">Email</span>
          <input value={session.email} readOnly className="field text-ink-muted" />
        </label>
      </section>
      <section className="mt-4 bg-paper border border-hairline rounded-md p-6">
        <p className="font-medium">Appearance</p>
        <p className="text-sm text-ink-muted mt-0.5 mb-4">Switch between light and dark view any time; it applies instantly and is remembered on this device. Artboards and visuals always render light, like frames on a canvas.</p>
        <ThemePicker />
      </section>
      <section className="mt-4 bg-paper border border-hairline rounded-md p-6 flex items-center justify-between">
        <div>
          <p className="font-medium">Sign out</p>
          <p className="text-sm text-ink-muted mt-0.5">Ends this session on this device.</p>
        </div>
        <form action={signOutAction}><button className={btnClass("secondary")}>Sign out</button></form>
      </section>
    </>
  );
}
