"use client";

/**
 * The Ideate map: a sitemap-style tree of how this piece gets made.
 *
 * At the top is what was answered once (the brand core: brief, voice, proof);
 * under it the pillars, then the angle, the topic, the piece itself and what
 * it will produce. The path this piece takes is drawn in ink, everything not
 * picked stays faint, and it follows the questions live: it listens to the
 * Ideate form, so picking a pillar or typing a topic redraws the branch.
 *
 * Lines are measured from the cards themselves and drawn as smooth curves
 * (one cubic per edge, bottom-centre to top-centre), so nothing snaps to a
 * grid and wrapping rows still connect.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, Compass, FileText, Fingerprint, Image as ImageIcon, LayoutGrid, Layers, MessageSquareQuote, PenLine, Quote, Type } from "lucide-react";
import { FORMATS } from "@/lib/content/formats";

type Pick = { format: string; pillarId: string; angle: string; topic: string };

export function IdeateTree({ formId, core, brief, pillars, initial }: {
  /** The Ideate form this map follows. */
  formId: string;
  core: { name: string; confidence: number; voiceLine: string; tones: string[]; samples: number; stories: number; proofs: number };
  brief: { niche: string; audience: string; positioning: string };
  pillars: { id: string; name: string }[];
  initial: Pick;
}) {
  const [pick, setPick] = useState<Pick>(initial);

  // Follow the form: every change or keystroke re-reads it.
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const read = () => {
      const fd = new FormData(form);
      setPick({
        format: String(fd.get("format") ?? ""),
        pillarId: String(fd.get("pillarId") ?? ""),
        angle: String(fd.get("angle") ?? ""),
        topic: String(fd.get("topic") ?? "").trim(),
      });
    };
    form.addEventListener("change", read);
    form.addEventListener("input", read);
    return () => { form.removeEventListener("change", read); form.removeEventListener("input", read); };
  }, [formId]);

  const format = FORMATS.find((f) => f.key === pick.format) ?? FORMATS[0];
  const pillar = pillars.find((p) => p.id === pick.pillarId) ?? null;
  const reply = !!format.reply;
  const outputs = [
    { key: "draft", icon: PenLine, title: "Drafts", sub: "2 versions in your voice" },
    ...(reply ? [] : [
      { key: "post", icon: ImageIcon, title: "Post image", sub: format.frame.label },
      { key: "quote", icon: Quote, title: "Quote card", sub: "1:1 · 1080×1080" },
      { key: "carousel", icon: LayoutGrid, title: "Carousel", sub: "4:5 frames" },
    ]),
  ];

  // Edges: parent → child. Every pillar flows into the angle, so an unpicked
  // pillar is a faint branch, not a missing one. A line is inked only when
  // everything above it is chosen, so the dark path reads top to bottom.
  const hasPillar = !!pillar || !pillars.length;
  const hasAngle = hasPillar && !!pick.angle;
  const hasTopic = hasAngle && !!pick.topic;
  const pillarKeys = pillars.length ? pillars.map((p) => ({ key: `pillar:${p.id}`, on: p.id === pillar?.id })) : [{ key: "pillar:none", on: true }];
  const edges: { from: string; to: string; on: boolean }[] = [
    ...pillarKeys.map((p) => ({ from: "core", to: p.key, on: p.on })),
    ...pillarKeys.map((p) => ({ from: p.key, to: "angle", on: p.on })),
    { from: "angle", to: "topic", on: hasAngle },
    { from: "topic", to: "piece", on: hasTopic },
    ...outputs.map((o) => ({ from: "piece", to: `out:${o.key}`, on: hasTopic })),
  ];

  const wrap = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const at = useCallback((key: string) => (el: HTMLElement | null) => { if (el) nodes.current.set(key, el); else nodes.current.delete(key); }, []);
  const [paths, setPaths] = useState<{ id: string; d: string; on: boolean }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const edgeKey = edges.map((e) => `${e.from}>${e.to}:${e.on ? 1 : 0}`).join("|");

  useEffect(() => {
    const box = wrap.current;
    if (!box) return;
    const measure = () => {
      const r = box.getBoundingClientRect();
      const next = edges.flatMap((e) => {
        const a = nodes.current.get(e.from)?.getBoundingClientRect();
        const b = nodes.current.get(e.to)?.getBoundingClientRect();
        if (!a || !b) return [];
        const x1 = a.left + a.width / 2 - r.left, y1 = a.bottom - r.top;
        const x2 = b.left + b.width / 2 - r.left, y2 = b.top - r.top;
        const bend = Math.max(18, (y2 - y1) * 0.55);
        return [{ id: `${e.from}>${e.to}`, on: e.on, d: `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}` }];
      });
      setPaths(next);
      setSize({ w: r.width, h: r.height });
    };
    const frame = requestAnimationFrame(measure);
    const ro = new ResizeObserver(() => measure());
    ro.observe(box);
    return () => { cancelAnimationFrame(frame); ro.disconnect(); };
    // edgeKey stands for `edges`, which is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edgeKey]);

  return (
    <figure className="relative" aria-label="How this piece is built">
      <figcaption className="flex items-baseline justify-between gap-3 mb-5">
        <span className="label-mono text-ink-faint">How this piece is built</span>
        <span className="flex items-center gap-3 text-xs text-ink-faint">
          <span className="flex items-center gap-1.5"><span className="w-5 h-[2px] rounded bg-ink" aria-hidden="true" /> This piece</span>
          <span className="flex items-center gap-1.5"><span className="w-5 h-[2px] rounded bg-line" aria-hidden="true" /> Not picked</span>
        </span>
      </figcaption>

      <div ref={wrap} className="relative flex flex-col items-center gap-9 pb-2">
        <svg className="absolute inset-0 pointer-events-none overflow-visible" width={size.w} height={size.h} aria-hidden="true">
          {/* Faint lines first, so the piece's path always sits on top. */}
          {[...paths].sort((a, b) => Number(a.on) - Number(b.on)).map((p) => (
            <path
              key={`${p.id}:${p.on}`}
              d={p.d}
              pathLength={1}
              className={p.on ? "hu-tree-line hu-tree-line--on" : "hu-tree-line"}
            />
          ))}
        </svg>

        {/* What was answered once */}
        <Node refAt={at("core")} icon={Fingerprint} label={`Brand core · ${core.name}`} on width="w-[min(100%,440px)]">
          <div className="grid grid-cols-2 gap-1.5">
            <Section icon={BookOpen} title="What you do" sub={brief.niche || brief.positioning || "Not answered yet"} empty={!brief.niche && !brief.positioning} />
            <Section icon={Compass} title="Who it's for" sub={brief.audience || "Not answered yet"} empty={!brief.audience} />
            <Section icon={Type} title="How you sound" sub={core.tones.length ? core.tones.join(", ") : core.voiceLine || "Not measured yet"} empty={!core.tones.length && !core.voiceLine} />
            <Section icon={MessageSquareQuote} title="What it learned from" sub={`${core.samples} pieces · ${core.stories} stories · ${core.proofs} proofs`} empty={!core.samples} />
          </div>
          <p className="text-xs text-ink-faint mt-2 text-center num">{core.confidence}% confident · answered once, used by every piece</p>
        </Node>

        {/* The pillars: one is this piece's */}
        <div className="flex flex-wrap justify-center gap-3 max-w-full">
          {pillars.length ? pillars.map((p) => (
            <Node key={p.id} refAt={at(`pillar:${p.id}`)} icon={Layers} label="Pillar" on={p.id === pillar?.id} dim={!!pillar && p.id !== pillar.id} width="w-[176px]">
              <p className="text-sm font-medium leading-snug">{p.name}</p>
            </Node>
          )) : (
            <Node refAt={at("pillar:none")} icon={Layers} label="Pillar" on width="w-[200px]">
              <p className="text-sm text-ink-muted">No pillars yet: written from the brief alone</p>
            </Node>
          )}
        </div>

        <Node refAt={at("angle")} icon={Compass} label="The angle" on={hasAngle} ghost={!pick.angle} width="w-[240px]">
          <p className="text-sm font-medium leading-snug">{pick.angle || "Pick an angle"}</p>
        </Node>

        <Node refAt={at("topic")} icon={FileText} label="What it's about" on={hasTopic} ghost={!pick.topic} width="w-[min(100%,320px)]">
          <p className="text-sm leading-snug line-clamp-3">{pick.topic || "One line on the topic"}</p>
        </Node>

        <Node refAt={at("piece")} icon={PenLine} label="The piece" on={hasTopic} ghost={!hasTopic} width="w-[min(100%,340px)]">
          <p className="text-sm font-medium">{format.label}</p>
          <p className="text-xs text-ink-muted mt-1 leading-relaxed">
            Written from your core{pillar ? `, under ${pillar.name}` : ""}{pick.angle ? `, as "${pick.angle.toLowerCase()}"` : ""}. Nothing to re-brief.
          </p>
        </Node>

        <div className="flex flex-wrap justify-center gap-3 max-w-full">
          {outputs.map((o) => (
            <Node key={o.key} refAt={at(`out:${o.key}`)} icon={o.icon} label={o.title} on={hasTopic} ghost={!hasTopic} width="w-[150px]">
              <p className="text-xs text-ink-muted">{o.sub}</p>
            </Node>
          ))}
        </div>
      </div>
    </figure>
  );
}

function Node({ refAt, icon: Icon, label, children, on = false, dim = false, ghost = false, width }: {
  refAt: (el: HTMLElement | null) => void;
  icon: typeof Layers;
  label: string;
  children: ReactNode;
  on?: boolean;
  dim?: boolean;
  ghost?: boolean;
  width: string;
}) {
  return (
    <div
      ref={refAt}
      className={`relative z-10 ${width} rounded-xl bg-paper border transition-[opacity,border-color,box-shadow] duration-300 ${
        ghost ? "border-dashed border-line text-ink-faint" : on ? "border-line-strong shadow-[var(--shadow-sm)]" : "border-hairline"
      } ${dim ? "opacity-45" : ""}`}
    >
      <p className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-ink-muted border-b border-hairline">
        <Icon size={12} aria-hidden="true" /> <span className="truncate">{label}</span>
      </p>
      <div className="px-3 py-2.5">{children}</div>
    </div>
  );
}

function Section({ icon: Icon, title, sub, empty }: { icon: typeof Layers; title: string; sub: string; empty?: boolean }) {
  return (
    <div className={`rounded-lg border px-2.5 py-2 min-w-0 ${empty ? "border-dashed border-line" : "border-hairline"}`}>
      <p className="flex items-center gap-1.5 text-xs font-semibold"><Icon size={11} aria-hidden="true" className="text-ink-faint shrink-0" /> {title}</p>
      <p className={`text-xs leading-snug mt-0.5 line-clamp-2 ${empty ? "text-ink-faint" : "text-ink-muted"}`}>{sub}</p>
    </div>
  );
}
