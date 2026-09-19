"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { demoWorkspaces } from "@/lib/demo/data";

export function WorkspaceSwitcher() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(demoWorkspaces[0]);

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-3 w-full text-left group">
        <span className="w-9 h-9 rounded-full bg-ink text-white flex items-center justify-center text-sm font-semibold shrink-0">{current.initial}</span>
        <span className="min-w-0 flex-1">
          <span className="text-sm font-medium block truncate leading-tight">{current.name}</span>
          <span className="label-mono block truncate text-ink-faint">{current.handle}</span>
        </span>
        <ChevronDown size={15} className="text-ink-faint shrink-0 group-hover:text-ink transition-colors" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 mt-2 z-20 bg-paper border border-hairline shadow-[var(--shadow)] p-1.5 pop">
            <p className="label-mono px-2.5 py-1.5 text-ink-faint">Switch workspace</p>
            {demoWorkspaces.map((w) => (
              <button key={w.name} onClick={() => { setCurrent(w); setOpen(false); }} className="flex items-center gap-2.5 w-full px-2.5 py-2 text-left hover:bg-muted-surface transition-colors">
                <span className="w-7 h-7 rounded-full bg-muted-surface flex items-center justify-center text-xs font-semibold shrink-0">{w.initial}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-sm block truncate leading-tight">{w.name}</span>
                  <span className="label-mono block truncate text-ink-faint">{w.handle}</span>
                </span>
                {current.name === w.name && <Check size={15} className="text-accent shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
