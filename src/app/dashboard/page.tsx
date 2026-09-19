"use client";

import { useRef, useState } from "react";
import {
  Box, ChevronDown, PenLine, Image as ImageIcon, CalendarDays, Lightbulb,
  Target, Fingerprint, Package, Share2, Play, Rocket, MousePointer2, Hand,
  MessageSquare, Plus, ArrowUp, Sparkles, PanelLeftClose, PanelLeftOpen,
  Monitor, Tablet, Smartphone, ThumbsUp, MessageCircle, Repeat2, Send,
  MoreHorizontal, Globe, type LucideIcon,
} from "lucide-react";
import { useToast } from "@/components/ui";
import { demoVariants, demoQuote, demoCarousel, brandPalette, pillars, pillarColor, demoIdeas, demoOffers, strategyTools } from "@/lib/demo/data";

type Mode = "content" | "visual" | "calendar" | "ideas" | "strategy" | "foundation" | "offers";
const [ink, accent, paper] = brandPalette;

const RAIL: { key: Mode; label: string; icon: LucideIcon }[] = [
  { key: "content", label: "Content", icon: PenLine },
  { key: "visual", label: "Visual", icon: ImageIcon },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "ideas", label: "Ideas", icon: Lightbulb },
  { key: "strategy", label: "Strategy", icon: Target },
  { key: "foundation", label: "Brand", icon: Fingerprint },
  { key: "offers", label: "Offers", icon: Package },
];
const STAGES: { key: Mode; label: string }[] = [
  { key: "foundation", label: "Foundation" },
  { key: "content", label: "Content" },
  { key: "visual", label: "Visual" },
  { key: "calendar", label: "Calendar" },
];

/* ---------------------------------------------------------------- artboards */
function Frame({ label, tag, width = 520, children }: { label: string; tag?: string; width?: number; children: React.ReactNode }) {
  return (
    <div className="shrink-0" style={{ width }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="num-display text-[0.7rem] text-ink-faint">◳</span>
        <span className="text-[0.8rem] font-medium">{label}</span>
        {tag && <span className="label-mono text-ink-faint">{tag}</span>}
      </div>
      <div className="bg-paper border border-hairline shadow-[var(--shadow)] rounded-[6px] overflow-hidden">{children}</div>
    </div>
  );
}

function LinkedInArtboard({ text, flagged }: { text: string; flagged?: boolean }) {
  return (
    <div className="p-5">
      <div className="flex items-start gap-2.5">
        <span className="w-11 h-11 rounded-full bg-ink text-white flex items-center justify-center text-sm font-semibold shrink-0">A</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5"><span className="text-sm font-semibold">Alex Rivera</span><span className="text-xs text-ink-faint">· 1st</span></div>
          <p className="text-xs text-ink-faint leading-tight">Founder · Brand strategist for B2B experts</p>
          <p className="text-[0.7rem] text-ink-faint flex items-center gap-1 mt-0.5">2h · <Globe size={11} /></p>
        </div>
        <MoreHorizontal size={18} className="text-ink-faint" />
      </div>
      <p className="mt-3 text-[0.9rem] whitespace-pre-wrap leading-relaxed">{text}</p>
      {flagged && <p className="mt-3 text-xs text-accent-ink">⚑ “leverage” is on your don&apos;t-words list — flagged, not auto-removed.</p>}
      <div className="flex items-center justify-between mt-4 pt-3 text-[0.7rem] text-ink-faint border-t border-hairline">
        <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 rounded-full bg-accent inline-flex items-center justify-center"><ThumbsUp size={8} className="text-white" /></span> 128</span>
        <span>14 comments · 6 reposts</span>
      </div>
      <div className="grid grid-cols-4 mt-1">
        {[ThumbsUp, MessageCircle, Repeat2, Send].map((I, k) => <span key={k} className="flex items-center justify-center py-1.5 text-ink-faint"><I size={15} /></span>)}
      </div>
    </div>
  );
}

function QuoteArtboard() {
  return (
    <div className="aspect-square flex flex-col justify-between p-8" style={{ background: ink, color: paper }}>
      <span className="w-10 h-1.5 rounded-full" style={{ background: accent }} />
      <p className="text-2xl leading-snug" style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}>&ldquo;{demoQuote.text}&rdquo;</p>
      <p className="text-xs tracking-[0.2em] uppercase font-semibold" style={{ color: accent }}>{demoQuote.author}</p>
    </div>
  );
}

function CanvasContent({ mode, device }: { mode: Mode; device: number }) {
  if (mode === "content")
    return (
      <div className="flex gap-10 items-start">
        {demoVariants.map((t, i) => <Frame key={i} label={`Variant ${i + 1}`} tag="LinkedIn" width={device}><LinkedInArtboard text={t} flagged={i === 0} /></Frame>)}
      </div>
    );
  if (mode === "visual")
    return (
      <div className="flex gap-10 items-start">
        <Frame label="Quote card" tag="1:1" width={420}><QuoteArtboard /></Frame>
        <Frame label="Carousel" tag="5 slides" width={620}>
          <div className="flex gap-3 p-4 overflow-x-auto">
            {demoCarousel.map((s) => (
              <div key={s.n} className="shrink-0 w-40 aspect-square rounded-[4px] flex flex-col justify-between p-4" style={{ background: s.n % 2 ? paper : ink, color: s.n % 2 ? ink : paper, border: "1px solid var(--hairline)" }}>
                <span className="text-[0.65rem] tracking-widest font-semibold" style={{ color: accent }}>{s.n}/{demoCarousel.length}</span>
                <div><p className="text-sm font-semibold leading-tight">{s.title}</p></div>
              </div>
            ))}
          </div>
        </Frame>
      </div>
    );
  if (mode === "calendar")
    return (
      <Frame label="90-day plan" tag="September" width={760}>
        <div className="grid grid-cols-7 gap-px bg-hairline">
          {Array.from({ length: 28 }).map((_, i) => {
            const has = i % 2 === 0;
            const p = pillars[i % pillars.length];
            return (
              <div key={i} className="bg-paper min-h-20 p-2">
                <span className="text-[0.65rem] text-ink-faint">{i + 1}</span>
                {has && <span className="mt-1 block w-2 h-2 rounded-full" style={{ background: pillarColor[p] }} />}
              </div>
            );
          })}
        </div>
      </Frame>
    );

  if (mode === "ideas")
    return (
      <div>
        <p className="label-mono text-ink-faint mb-4">Pinboard · auto-tagged to pillars · drag onto Content to draft</p>
        <div className="flex flex-wrap gap-6 max-w-[880px]">
          {demoIdeas.map((idea, i) => (
            <div key={idea.id} className="w-56 bg-paper border border-hairline shadow-[var(--shadow)] p-4" style={{ transform: `rotate(${i % 2 ? 1.4 : -1.4}deg)` }}>
              <p className="text-[0.85rem] leading-snug">{idea.text}</p>
              <div className="flex items-center gap-2 mt-3">
                <span className="w-2 h-2 rounded-full" style={{ background: pillarColor[idea.pillar] }} />
                <span className="label-mono text-ink-faint">{idea.pillar} · via {idea.source}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );

  if (mode === "strategy")
    return (
      <div className="flex gap-10 items-start">
        <Frame label="3×3 Positioning matrix" tag="Authority" width={380}>
          <div className="p-5">
            <div className="grid grid-cols-3 grid-rows-3 border-l border-t border-hairline aspect-square">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="border-r border-b border-hairline flex items-center justify-center">
                  {i === 2 && <span className="w-8 h-8 rounded-full bg-accent text-white text-[0.6rem] font-semibold flex items-center justify-center">You</span>}
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-2"><span className="label-mono">Generalist</span><span className="label-mono">Specialist</span></div>
          </div>
        </Frame>
        <div className="flex flex-col gap-3 w-72">
          {strategyTools.map((t) => (
            <div key={t.key} className="bg-paper border border-hairline rounded-[6px] p-4 hover:border-ink transition-colors">
              <p className="text-sm font-medium">{t.title}</p>
              <p className="text-xs text-ink-muted mt-1 leading-relaxed">{t.desc}</p>
            </div>
          ))}
        </div>
      </div>
    );

  if (mode === "offers")
    return (
      <div className="flex gap-8 items-start">
        {demoOffers.map((o) => (
          <div key={o.id} className="w-72 bg-paper border border-hairline shadow-[var(--shadow)] rounded-[6px] p-6">
            <div className="flex items-start justify-between gap-2">
              <p className="text-base font-semibold leading-tight">{o.name}</p>
              <span className="label-mono shrink-0">{o.price}</span>
            </div>
            <p className="label-mono text-ink-faint mt-1">{o.format}</p>
            <p className="text-[1.05rem] mt-4 serif-accent">&ldquo;{o.promise}&rdquo;</p>
          </div>
        ))}
      </div>
    );

  // foundation — the brand book
  return (
    <Frame label="Brand Foundation" tag="v1 · 90%" width={620}>
      <div className="p-8">
        <p className="kicker mb-2">01 — Story</p>
        {["Left agency life to help founders.", "Learned brand is a system, not a logo.", "Packages expert authority into offers."].map((s, i) => (
          <p key={i} className="text-sm text-ink-muted flex gap-2 py-0.5"><span className="num-display text-ink-faint">{i + 1}</span> {s}</p>
        ))}
        <p className="kicker mt-6 mb-2">02 — Positioning</p>
        <p className="text-xl font-medium leading-snug">The brand professor for solo B2B experts.</p>
        <p className="kicker mt-6 mb-2">03 — Voice</p>
        <div className="flex gap-2 flex-wrap">{["direct", "warm", "contrarian"].map((v) => <span key={v} className="label-mono border border-hairline rounded-full px-2 py-0.5">{v}</span>)}</div>
        <p className="kicker mt-6 mb-2">04 — Visual</p>
        <div className="flex gap-2">{brandPalette.map((c) => <span key={c} className="w-9 h-9 rounded-[4px] border border-hairline" style={{ background: c }} />)}</div>
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ editor */
export default function CanvasEditor() {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("content");
  const [zoom, setZoom] = useState(80);
  const [chatOpen, setChatOpen] = useState(true);
  const [device, setDevice] = useState(520);
  const [tool, setTool] = useState<"select" | "hand" | "comment">("select");
  const [messages, setMessages] = useState<{ role: "ai" | "me"; text: string }[]>([
    { role: "ai", text: "I've loaded your brand context — direct, warm, contrarian; 4 pillars; foundation 90%. Ready when you are." },
    { role: "ai", text: "Here are two LinkedIn posts on your Contrarian takes pillar. Edit them on the canvas, or steer me below." },
  ]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const send = () => {
    const t = draft.trim();
    if (!t) return;
    setMessages((m) => [...m, { role: "me", text: t }]);
    setDraft("");
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      setMessages((m) => [...m, { role: "ai", text: "Done — 2 fresh variants are on the canvas, on-brand and guardrail-checked." }]);
      toast("2 variants generated on the canvas");
    }, 1100);
  };

  return (
    <div className="h-screen flex flex-col bg-ground">
      {/* Top toolbar */}
      <header className="h-14 shrink-0 flex items-center gap-3 px-4 border-b border-hairline bg-paper">
        <span className="w-8 h-8 rounded-[7px] bg-ink text-white flex items-center justify-center"><Box size={17} /></span>
        <button className="flex items-center gap-1.5 text-sm font-medium hover:bg-muted-surface rounded-[7px] px-2 py-1 transition-colors">
          Alex Rivera <span className="label-mono text-ink-faint">Personal brand</span> <ChevronDown size={14} className="text-ink-faint" />
        </button>

        <div className="mx-auto flex items-center gap-1 bg-muted-surface rounded-[9px] p-1">
          {STAGES.map((s) => (
            <button key={s.key} onClick={() => setMode(s.key)} className={`flex items-center gap-1.5 text-[0.8rem] font-medium px-3 py-1.5 rounded-[6px] transition-all ${mode === s.key ? "bg-paper shadow-[0_1px_2px_rgba(0,0,0,0.08)] text-ink" : "text-ink-muted hover:text-ink"}`}>
              {s.label}
            </button>
          ))}
        </div>

        <button onClick={() => toast("Share link copied")} className="flex items-center gap-1.5 text-sm font-medium border border-line rounded-[7px] px-3 py-1.5 hover:border-ink transition-colors"><Share2 size={15} /> Share</button>
        <button onClick={() => toast("Preview")} className="w-8 h-8 rounded-[7px] flex items-center justify-center hover:bg-muted-surface transition-colors"><Play size={16} /></button>
        <button onClick={() => toast("Exported · brand kit")} className="flex items-center gap-1.5 text-sm font-medium bg-accent text-white rounded-[7px] px-3.5 py-1.5 hover:brightness-105 transition-all"><Rocket size={15} /> Export</button>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Thin rail (collapsed modules) */}
        <nav className="w-16 shrink-0 bg-paper border-r border-hairline flex flex-col items-center py-3 gap-1">
          {RAIL.map((r) => {
            const active = mode === r.key;
            const Icon = r.icon;
            return (
              <button key={r.key} onClick={() => setMode(r.key)} className={`w-12 py-2 rounded-[8px] flex flex-col items-center gap-1 transition-colors ${active ? "bg-muted-surface" : "hover:bg-muted-surface/60"}`}>
                <Icon size={18} style={{ color: active ? "var(--accent)" : "var(--ink-muted)" }} />
                <span className="text-[0.6rem] tracking-tight" style={{ color: active ? "var(--ink)" : "var(--ink-faint)" }}>{r.label}</span>
              </button>
            );
          })}
        </nav>

        {/* AI chat panel */}
        {chatOpen && (
          <aside className="w-[340px] shrink-0 bg-paper border-r border-hairline flex flex-col">
            <div className="h-11 flex items-center justify-between px-4 border-b border-hairline">
              <div className="flex items-center gap-2"><Sparkles size={15} className="text-accent" /><span className="text-sm font-semibold">Assistant</span></div>
              <button onClick={() => setChatOpen(false)} className="text-ink-faint hover:text-ink"><PanelLeftClose size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              <div className="inline-flex items-center gap-2 self-start label-mono text-ink-muted bg-muted-surface rounded-full px-2.5 py-1"><Fingerprint size={12} /> Brand context loaded · 90%</div>
              {messages.map((m, i) => (
                m.role === "ai"
                  ? <p key={i} className="text-[0.85rem] leading-relaxed text-ink">{m.text}</p>
                  : <p key={i} className="text-[0.85rem] leading-relaxed bg-ink text-white rounded-[10px] px-3 py-2 self-end max-w-[85%]">{m.text}</p>
              ))}
              {busy && <div className="inline-flex items-center gap-2 self-start text-[0.85rem] text-ink-muted bg-accent-soft rounded-[10px] px-3 py-2"><span className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" /> Generating draft…</div>}
            </div>
            <div className="p-3 border-t border-hairline">
              <div className="border border-line rounded-[10px] p-2 focus-within:border-ink transition-colors">
                <textarea ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} rows={2} placeholder="Ask Huemen to write, restyle or repurpose…" className="w-full text-sm bg-transparent resize-none focus:outline-none placeholder:text-ink-faint" />
                <div className="flex items-center justify-between mt-1">
                  <button className="w-7 h-7 rounded-[7px] flex items-center justify-center hover:bg-muted-surface text-ink-muted"><Plus size={15} /></button>
                  <button onClick={send} className="w-7 h-7 rounded-[7px] bg-ink text-white flex items-center justify-center hover:bg-accent transition-colors"><ArrowUp size={15} /></button>
                </div>
              </div>
              <p className="label-mono text-ink-faint mt-2 text-center">Responses are powered by your brand foundation</p>
            </div>
          </aside>
        )}

        {/* Canvas — the main workspace */}
        <div className="flex-1 min-w-0 relative overflow-auto" style={{ background: "var(--ground)", backgroundImage: "radial-gradient(var(--hairline) 1px, transparent 1px)", backgroundSize: "22px 22px" }}>
          {!chatOpen && (
            <button onClick={() => setChatOpen(true)} className="absolute top-4 left-4 z-10 flex items-center gap-2 bg-paper border border-hairline rounded-[8px] px-3 py-2 text-sm shadow-[var(--shadow)] hover:border-ink transition-colors"><PanelLeftOpen size={16} /> Assistant</button>
          )}
          <div className="p-24 min-w-max min-h-full" style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top left", cursor: tool === "hand" ? "grab" : "default" }}>
            <div className="mb-6 flex items-center gap-3">
              <span className="kicker">{STAGES.find((s) => s.key === mode)?.label ?? RAIL.find((r) => r.key === mode)?.label} — canvas</span>
              <span className="rule flex-1" />
            </div>
            <CanvasContent mode={mode} device={device} />
          </div>

          {/* Bottom floating toolbar */}
          <div className="sticky bottom-6 float-right mr-6 inline-flex items-center gap-1 bg-paper border border-hairline rounded-[10px] px-2 py-1.5 shadow-[var(--shadow-lg)]" style={{ position: "sticky" }}>
            {([["select", MousePointer2], ["hand", Hand], ["comment", MessageSquare]] as const).map(([k, I]) => (
              <button key={k} onClick={() => setTool(k)} className={`w-8 h-8 rounded-[7px] flex items-center justify-center transition-colors ${tool === k ? "bg-accent-soft text-accent-ink" : "text-ink-muted hover:bg-muted-surface"}`}><I size={16} /></button>
            ))}
            <span className="w-px h-5 bg-hairline mx-1" />
            <button onClick={() => setZoom((z) => Math.max(30, z - 10))} className="w-8 h-8 rounded-[7px] flex items-center justify-center text-ink-muted hover:bg-muted-surface">−</button>
            <span className="label-mono w-10 text-center text-ink">{zoom}%</span>
            <button onClick={() => setZoom((z) => Math.min(150, z + 10))} className="w-8 h-8 rounded-[7px] flex items-center justify-center text-ink-muted hover:bg-muted-surface">+</button>
            <span className="w-px h-5 bg-hairline mx-1" />
            {([["desktop", Monitor, 520], ["tablet", Tablet, 460], ["mobile", Smartphone, 380]] as const).map(([k, I, w]) => (
              <button key={k} onClick={() => setDevice(w)} className={`w-8 h-8 rounded-[7px] flex items-center justify-center transition-colors ${device === w ? "bg-muted-surface text-ink" : "text-ink-muted hover:bg-muted-surface"}`}><I size={15} /></button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
