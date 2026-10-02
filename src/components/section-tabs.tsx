"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Section tabs. Selected is a 2px bottom border plus weight (design system
 * §08: "a 2px bottom border for tabs, always paired with a non-colour cue").
 */
export function SectionTabs({ tabs }: { tabs: { href: string; label: string; exact?: boolean }[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 px-4 overflow-x-auto" aria-label="Section">
      {tabs.map((t) => {
        const on = t.exact ? path === t.href : path === t.href || path.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`shrink-0 min-h-11 px-3 flex items-center text-[0.85rem] border-b-2 -mb-px transition-colors ${
              on ? "border-ink text-ink font-medium" : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
