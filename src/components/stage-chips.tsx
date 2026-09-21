import { FileText, Network, PenLine, Palette, Download } from "lucide-react";

/** The five-stage pipeline, as shown on intake/landing (Relume's stage strip). */
export const STAGE_DEFS = [
  { key: "brief", label: "Brief", icon: FileText },
  { key: "pillars", label: "Pillars", icon: Network },
  { key: "content", label: "Content", icon: PenLine },
  { key: "visual", label: "Visual", icon: Palette },
  { key: "export", label: "Export", icon: Download },
] as const;

export function StageChips({ active = "brief" }: { active?: string }) {
  return (
    <div className="flex items-center justify-center gap-1 flex-wrap">
      {STAGE_DEFS.map((s, i) => {
        const Icon = s.icon;
        const on = s.key === active;
        return (
          <div key={s.key} className="flex items-center gap-1">
            {i > 0 && <span className="w-4 border-t border-dashed border-line" />}
            <span className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[8px] text-[0.8rem] ${on ? "bg-paper shadow-[var(--shadow-sm)] text-ink font-medium" : "text-ink-faint"}`}>
              <Icon size={13} /> {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
