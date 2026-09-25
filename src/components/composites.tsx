/**
 * Design-system composites §15 — the pieces that carry the product's colour.
 * Built from tokens only.
 *
 *  - HueStrip   §15.1  the signature spectrum bar (the "hueman" mark)
 *  - ScoreMeter §15.3  three bands, each with a colour, a word and a position, so
 *                      the verdict survives greyscale and a colour-blind reader
 *  - Findings   §15.4  line-level findings: the line, the attribute it's measured
 *                      against with evidence, and the fix in the person's voice
 */
import type { ReactNode } from "react";
import { Badge } from "@/components/ui";

const STRIP_HUES = ["--hue-magenta", "--hue-coral", "--hue-orange", "--hue-yellow", "--hue-green", "--hue-teal", "--hue-blue", "--hue-violet"];

export function HueStrip({ count = 4, className = "" }: { count?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={`flex h-1.5 rounded-full overflow-hidden ${className}`}>
      {STRIP_HUES.slice(0, count).map((h) => (
        <span key={h} className="flex-1" style={{ background: `var(${h})` }} />
      ))}
    </div>
  );
}

type Band = "on" | "drift" | "off";
const BAND_TONE: Record<Band, { fill: string; tone: "ok" | "warn" | "danger"; word: string }> = {
  on: { fill: "var(--ok-line)", tone: "ok", word: "On brand" },
  drift: { fill: "var(--warn-line)", tone: "warn", word: "Drifting" },
  off: { fill: "var(--danger-line)", tone: "danger", word: "Off brand" },
};

export function bandFromScore(score: number, thresholds: [number, number] = [85, 60]): Band {
  if (score >= thresholds[0]) return "on";
  if (score >= thresholds[1]) return "drift";
  return "off";
}

export function ScoreMeter({
  score, band, scale = ["Off", "Drifting", "On"], word, out = "/100", thresholds,
}: {
  score: number; band?: Band; scale?: [string, string, string]; word?: string; out?: string; thresholds?: [number, number];
}) {
  const b = band ?? bandFromScore(score, thresholds);
  const t = BAND_TONE[b];
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[1.9rem] font-medium tabular-nums leading-none">{score}<span className="text-[0.9rem] text-ink-faint">{out}</span></span>
        <Badge tone={t.tone}>{word ?? t.word}</Badge>
      </div>
      <div className="mt-3 h-2 rounded-full bg-field overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(0, Math.min(100, score))}%`, background: t.fill }} />
      </div>
      <div className="mt-1.5 flex justify-between label-mono text-ink-faint">
        {scale.map((s) => <span key={s}>{s}</span>)}
      </div>
    </div>
  );
}

export type Finding = { verdict: Band; text: string; why?: ReactNode; fix?: string };

export function Findings({ items }: { items: Finding[] }) {
  const label: Record<Band, string> = { on: "On", drift: "Drift", off: "Off" };
  return (
    <div className="flex flex-col divide-y divide-[var(--hairline)] border border-hairline rounded-[12px] overflow-hidden">
      {items.map((f, i) => {
        const t = BAND_TONE[f.verdict];
        return (
          <div key={i} className="flex gap-3 p-3.5" style={{ background: f.verdict === "on" ? undefined : `color-mix(in srgb, var(--${t.tone}-soft) 55%, transparent)` }}>
            <span className="label-mono h-5 px-2 rounded-full inline-flex items-center shrink-0" style={{ color: `var(--${t.tone})`, background: `var(--${t.tone}-soft)` }}>{label[f.verdict]}</span>
            <div className="min-w-0">
              <p className="text-[0.85rem] leading-relaxed">{f.text}</p>
              {f.why && <p className="text-[0.78rem] text-ink-muted mt-1">{f.why}</p>}
              {f.fix && <p className="text-[0.78rem] mt-1"><span className="text-ink-faint">Suggested: </span>{f.fix}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
