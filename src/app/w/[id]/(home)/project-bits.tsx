/**
 * Small pieces the library and Brand home both show for a project: its voice
 * band pill and "edited 3 days ago". No hooks, so either side can render them.
 */
import type { Stage } from "@/lib/projects/stages";

export type Project = {
  id: string; name: string; stage: Stage; updatedAt: string; createdAt: string; completeness: number; niche: string | null;
  palette: string[]; pillarCount: number; contentCount: number; firstHook: string | null; starred: boolean;
  format: string | null; contentStatus: string | null;
  voiceBand: "on_brand" | "drifting" | "off_brand" | null; voiceScore: number | null;
};

export const STATUS_LABEL: Record<string, string> = { none: "No copy yet", draft: "Draft", edited: "Edited", approved: "Approved" };
export const BAND_LABEL: Record<string, string> = { on_brand: "On brand", drifting: "Drifting", off_brand: "Off brand", unchecked: "Not checked" };
const BAND_TONE: Record<string, string> = {
  on_brand: "bg-ok-soft text-ok", drifting: "bg-warn-soft text-warn", off_brand: "bg-danger-soft text-danger", unchecked: "bg-ground text-ink-faint",
};

export function BandPill({ p }: { p: Project }) {
  if (!p.contentStatus) return null;
  const b = p.voiceBand ?? "unchecked";
  return (
    <span className={`label-mono inline-flex items-center gap-1.5 h-5 px-2 rounded-full shrink-0 ${BAND_TONE[b]}`} title={p.voiceScore != null ? `${p.voiceScore}/100 against your voice` : "Not checked yet"}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />
      {p.voiceScore != null ? p.voiceScore : "–"}
      <span className="sr-only"> {BAND_LABEL[b]}</span>
    </span>
  );
}

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(1, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  const mo = Math.round(d / 30); return mo < 12 ? `${mo} month${mo === 1 ? "" : "s"} ago` : `${Math.round(mo / 12)} year ago`;
}
