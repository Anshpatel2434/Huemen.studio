"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { UserSquare2, Sparkles, Users } from "lucide-react";
import { btnClass } from "@/components/btn";
import { PageTransition } from "@/components/page-transition";

export function SettingsNav({ children, isAdmin, home }: { children: ReactNode; isAdmin: boolean; home: string }) {
  const path = usePathname();
  const items = [
    { href: "/settings", label: "Account", icon: UserSquare2 },
    { href: "/settings/usage", label: "AI usage", icon: Sparkles },
    ...(isAdmin ? [{ href: "/settings/workspaces", label: "Workspaces & access", icon: Users }] : []),
  ];
  return (
    <>
      <header className="h-12 shrink-0 flex items-center px-2 border-b border-hairline">
        <Link href={home} className={btnClass("secondary", "sm")}>Back</Link>
      </header>
      <div className="flex-1 flex min-h-0">
        <aside className="w-[260px] shrink-0 border-r border-hairline p-3">
          <p className="label-mono text-ink-muted px-2 pt-2 pb-3">Account settings</p>
          <nav className="flex flex-col gap-0.5">
            {items.map((i) => {
              const Icon = i.icon;
              const on = path === i.href;
              return (
                <Link key={i.href} href={i.href} className={`flex items-center gap-2.5 h-9 px-2.5 rounded-[8px] text-[0.875rem] transition-colors ${on ? "bg-accent-soft text-ink font-medium" : "text-ink-muted hover:bg-field"}`}>
                  <Icon size={15} /> {i.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[640px] mx-auto px-8 py-10">
            <PageTransition level="page">{children}</PageTransition>
          </div>
        </main>
      </div>
    </>
  );
}
