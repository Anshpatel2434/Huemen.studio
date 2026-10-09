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
import { Badge, Avatar } from "@/components/ui";

const STRIP_HUES = ["--hue-magenta", "--hue-coral", "--hue-orange", "--hue-yellow", "--hue-green", "--hue-teal", "--hue-blue", "--hue-violet"];

/**
 * Brand core card §15.1 — the single object the product revolves around: what the
 * system concluded about how someone sounds. Carries the product's colour: the
 * hue strip, a coloured avatar, the confidence number (never rounded up, never
 * hidden once trained) and the voice attributes.
 */
export function BrandCoreCard({
  name, seed, subtitle, trained, attributes, confidence, stats, state = "trained",
}: {
  name: string; seed: string; subtitle: string; trained: boolean;
  attributes: string[]; confidence: number;
  stats: { label: string; value: string }[];
  /** §15.2: Empty, Ingesting, Learning, Trained. Trained below 70% reads Provisional. */
  state?: "empty" | "ingesting" | "learning" | "trained";
}) {
  const badge =
    state === "empty" ? { tone: "neutral" as const, word: "Not started" }
    : state === "ingesting" ? { tone: "accent" as const, word: "Reading your writing" }
    : state === "learning" ? { tone: "accent" as const, word: "Building your core" }
    : trained ? { tone: "ok" as const, word: "Trained" }
    : { tone: "warn" as const, word: "Provisional" };
  return (
    <div className="@container bg-paper border border-hairline rounded-md overflow-hidden">
      <HueStrip count={8} className="!rounded-none" />
      <div className="p-6">
        {/* Sized by its own width (container query), so it reads the same in a
            360px column on Brand home and full width in Brand core. */}
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3">
          <Avatar seed={seed} label={name} size="lg" />
          <div className="min-w-0 flex-1 basis-[12ch]">
            <p className="text-lg font-medium leading-snug break-words">{name}</p>
            <p className="text-sm text-ink-muted break-words">{subtitle}</p>
          </div>
          <span className="@md:order-none order-last w-full @md:w-auto"><Badge tone={badge.tone}>{badge.word}</Badge></span>
        </div>

        {attributes.length > 0 && (
          <div className="mt-5">
            <p className="label-mono text-ink-faint mb-2">Voice</p>
            <div className="flex flex-wrap gap-1.5">
              {attributes.map((a) => (
                <span key={a} className="label-mono px-2.5 h-6 inline-flex items-center rounded-sm bg-accent-soft text-accent-ink">{a}</span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 pt-5 border-t border-hairline grid grid-cols-2 @md:grid-cols-4 gap-x-3 gap-y-4">
          <div>
            <p className="num text-xl font-medium leading-none" style={{ color: trained ? "var(--ok)" : "var(--ink)" }}>{confidence}<span className="text-sm text-ink-faint">%</span></p>
            <p className="label-mono text-ink-faint mt-1">Confidence</p>
          </div>
          {stats.map((s) => (
            <div key={s.label}>
              <p className="num text-xl font-medium leading-none">{s.value}</p>
              <p className="label-mono text-ink-faint mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

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
        <span className="num text-2xl font-medium leading-none">{score}<span className="text-sm text-ink-faint">{out}</span></span>
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
    <div className="flex flex-col divide-y divide-[var(--hairline)] border border-hairline rounded-md overflow-hidden">
      {items.map((f, i) => {
        const t = BAND_TONE[f.verdict];
        return (
          <div key={i} className="flex gap-3 p-3.5" style={{ background: f.verdict === "on" ? undefined : `color-mix(in srgb, var(--${t.tone}-soft) 55%, transparent)` }}>
            <span className="label-mono h-5 px-2 rounded-full inline-flex items-center shrink-0" style={{ color: `var(--${t.tone})`, background: `var(--${t.tone}-soft)` }}>{label[f.verdict]}</span>
            <div className="min-w-0">
              <p className="text-sm leading-relaxed">{f.text}</p>
              {f.why && <p className="text-xs text-ink-muted mt-1">{f.why}</p>}
              {f.fix && <p className="text-xs mt-1"><span className="text-ink-faint">Suggested: </span>{f.fix}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The composer's collapsed core §15.7: whose voice is in use, how sure the
 * system is, and the words it learned. Sits beside every draft.
 */
export function CoreAside({ name, seed, confidence, attributes, trained, children }: {
  name: string; seed: string; confidence: number; attributes: string[]; trained: boolean; children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Avatar seed={seed} label={name} size="md" />
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{name}</p>
          <p className="label-mono text-ink-faint">
            <span className="num" style={{ color: trained ? "var(--ok)" : undefined }}>{confidence}%</span> confident
          </p>
        </div>
      </div>
      {attributes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attributes.map((a) => <span key={a} className="hu-tag">{a}</span>)}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * Usage and limits §15.5: shown before it becomes a wall, always with the
 * reset date so a limit reads as a rhythm, not a punishment.
 */
export function UsageMeter({ rows, resets, footer }: {
  rows: { label: string; used: number; cap: number | null }[];
  /** e.g. "1 November". */
  resets: string;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      {rows.map((r) => {
        const pct = r.cap ? Math.min(100, (r.used / r.cap) * 100) : 0;
        const near = r.cap ? r.used / r.cap >= 0.8 : false;
        return (
          <div key={r.label}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span>{r.label}</span>
              <span className="num text-ink-muted">{r.used}{r.cap ? <span className="text-ink-faint"> / {r.cap}</span> : <span className="text-ink-faint"> · no cap</span>}</span>
            </div>
            {r.cap ? (
              <div className="mt-2 h-1.5 rounded-full bg-active overflow-hidden" role="progressbar" aria-label={r.label} aria-valuemin={0} aria-valuemax={r.cap} aria-valuenow={r.used}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: near ? "var(--warn-line)" : "var(--accent)" }} />
              </div>
            ) : null}
          </div>
        );
      })}
      <p className="text-xs text-ink-faint">Resets {resets}.{footer ? <> {footer}</> : null}</p>
    </div>
  );
}
