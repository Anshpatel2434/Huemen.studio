"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Section tabs (§14): the selected one carries a 2px underline plus weight,
 * never colour alone, and every tab is a 44px target.
 */
export function SectionTabs({ tabs }: { tabs: { href: string; label: string; exact?: boolean }[] }) {
  const path = usePathname();
  return (
    <nav className="hu-tabs !border-b-0 px-2 min-[900px]:px-3 overflow-x-auto !flex-nowrap" aria-label="Section">
      {tabs.map((t) => {
        const on = t.exact ? path === t.href : path === t.href || path.startsWith(`${t.href}/`);
        return (
          <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined} className="hu-tab">
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
