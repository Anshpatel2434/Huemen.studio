"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: { href: string; label: string; group?: string }[] = [
  { href: "/dashboard", label: "Overview", group: "" },
  { href: "/dashboard/studio", label: "Content Studio", group: "Create" },
  { href: "/dashboard/visual", label: "Visual Studio" },
  { href: "/dashboard/calendar", label: "Calendar", group: "Plan" },
  { href: "/dashboard/ideas", label: "Idea Inbox" },
  { href: "/dashboard/strategy", label: "Strategy" },
  { href: "/dashboard/foundation", label: "Brand Foundation", group: "Brand" },
  { href: "/dashboard/offers", label: "Offers" },
];

export function SidebarNav({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/dashboard" ? path === href : path.startsWith(href));

  return (
    <nav>
      {ITEMS.map((item, i) => {
        const active = isActive(item.href);
        const n = String(i + 1).padStart(2, "0");
        return (
          <div key={item.href}>
            {item.group !== undefined && item.group !== "" && (
              <p className="label-mono mt-6 mb-2 text-ink-faint">{item.group}</p>
            )}
            {item.group === "" && i === 0 && <p className="label-mono mb-2 text-ink-faint">Index</p>}
            <Link href={item.href} className="group flex items-baseline gap-3 py-[7px] border-b border-hairline">
              <span
                className="num-display text-xs w-6 shrink-0 tnum transition-colors"
                style={{ color: active ? "var(--accent)" : "var(--ink-faint)" }}
              >
                {n}
              </span>
              <span
                className={`text-[0.95rem] transition-all ${active ? "text-ink font-medium" : "text-ink-muted group-hover:text-ink group-hover:translate-x-0.5"}`}
              >
                {item.label}
              </span>
              {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent shrink-0 self-center" />}
              {!active && <span className="ml-auto text-ink-faint opacity-0 group-hover:opacity-100 transition-opacity shrink-0 self-center">→</span>}
            </Link>
          </div>
        );
      })}
      {isAdmin && (
        <Link href="/admin" className="group flex items-baseline gap-3 py-[7px] mt-3 border-b border-hairline">
          <span className="num-display text-xs w-6 shrink-0 text-accent">★</span>
          <span className="text-[0.95rem] text-accent-ink group-hover:translate-x-0.5 transition-transform">Admin</span>
        </Link>
      )}
    </nav>
  );
}
