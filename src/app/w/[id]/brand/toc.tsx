"use client";

import { useEffect, useState } from "react";

/** Right-hand table of contents with scroll-spy (Relume brief layout). */
export function BriefToc({ sections }: { sections: { id: string; label: string }[] }) {
  const [active, setActive] = useState(sections[0]?.id);
  useEffect(() => {
    const root = document.getElementById("brief-scroll");
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { root, rootMargin: "0px 0px -65% 0px" },
    );
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [sections]);

  return (
    <nav className="border-l border-hairline" aria-label="Brief sections">
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className={`block pl-4 py-1.5 text-[0.85rem] -ml-px border-l transition-colors ${active === s.id ? "border-ink text-ink" : "border-transparent text-ink-faint hover:text-ink"}`}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}
