import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/auth/types";
import { signOutAction } from "./actions";

const NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/foundation", label: "Brand Foundation" },
  { href: "/dashboard/studio", label: "Content Studio" },
  { href: "/dashboard/visual", label: "Visual Studio" },
  { href: "/dashboard/calendar", label: "Calendar" },
  { href: "/dashboard/ideas", label: "Idea Inbox" },
  { href: "/dashboard/offers", label: "Offers" },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const admin = isPlatformAdmin(session.role);

  return (
    <div className="flex-1 flex">
      <aside className="w-60 border-r border-hairline flex flex-col p-6 shrink-0">
        <p className="eyebrow mb-8">Huemen.studio</p>
        <nav className="flex flex-col gap-1 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="py-1.5 text-ink-muted hover:text-ink transition-colors"
            >
              {item.label}
            </Link>
          ))}
          {admin && (
            <Link
              href="/admin"
              className="py-1.5 mt-4 text-accent hover:opacity-70 transition-opacity"
            >
              Admin ↗
            </Link>
          )}
        </nav>
        <div className="mt-auto pt-8 border-t border-hairline">
          <p className="eyebrow">{session.role.replace("_", " ")}</p>
          <p className="text-xs text-ink-faint mt-1 truncate">{session.email}</p>
          <form action={signOutAction} className="mt-3">
            <button className="text-xs text-ink-muted hover:text-accent" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 px-10 py-10 max-w-4xl">{children}</main>
    </div>
  );
}
