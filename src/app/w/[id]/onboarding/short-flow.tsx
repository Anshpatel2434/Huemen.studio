"use client";

/**
 * The short onboarding: one question per screen, Obello-style. The question
 * and its Continue sit on the left; the one thing to do sits on the right, in
 * a sunken panel. Seven screens, dots underneath, about five minutes.
 *
 * Everything deeper (dials, the party questions, guardrails, languages,
 * beliefs, stories, facts, pillars) waits in Getting started, after the first
 * piece, so nothing here stands between a person and their own voice.
 *
 * Typed answers are drafts (`useStepDraft`) until saved, so a reload keeps them.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { ArrowLeft, Check, Circle, FileUp, ImagePlus, Loader2, Plus } from "lucide-react";
import { btnClass } from "@/components/btn";
import { AgentDots } from "@/components/ui";
import { ScoreMeter } from "@/components/composites";
import { ingestLinkedIn, ingestText, splitPieces, stripEmail, type IngestedPiece } from "@/lib/voice/ingest";
import { WORDS, MIN_PICKS, MAX_PICKS } from "@/lib/voice/words";
import { MAX_REFERENCES } from "@/lib/visual/core";
import { SCREENS, type ScreenKey } from "@/lib/onboarding/screens";
import { uploadAssetAction } from "@/app/w/[id]/brand/actions";
import {
  advanceAction, audienceAction, finishIngestAction, finishOnboardingAction, firstPieceAction, ingestAction, lookAction,
  markIngestingAction, nameAction, saveSourcesAction, siteAction, voiceNotesAction, wordsAction,
} from "./actions";
import { useStepDraft } from "./draft";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HEX = /^#[0-9a-f]{6}$/i;

// =============================================================================
// The frame
// =============================================================================

function Dots({ at }: { at: ScreenKey }) {
  const i = SCREENS.indexOf(at);
  return (
    <ol className="flex items-center justify-center gap-2.5" aria-label={`Step ${i + 1} of ${SCREENS.length}`}>
      {SCREENS.map((s, n) => (
        <li
          key={s}
          aria-current={n === i ? "step" : undefined}
          className={`h-2 rounded-full transition-all duration-300 ${n === i ? "w-6 bg-ink" : n < i ? "w-2 bg-ink-faint" : "w-2 bg-hover"}`}
        />
      ))}
    </ol>
  );
}

/**
 * The split screen. `actions` go under the question (Continue first);
 * `panel` is the one thing to do on this screen.
 */
function Split({ tenantId, at, back, title, sub, actions, panel, wide }: {
  tenantId: string; at: ScreenKey; back?: ScreenKey; title: ReactNode; sub?: ReactNode; actions: ReactNode; panel: ReactNode; wide?: boolean;
}) {
  return (
    <div className="absolute inset-0 overflow-y-auto bg-paper">
      <div className="min-h-full grid grid-cols-1 lg:grid-cols-2 gap-4 p-3 sm:p-5">
        <section className="flex flex-col px-2 sm:px-8 py-4 lg:py-8">
          <div className="min-h-11">
            {back && (
              <Link href={`/w/${tenantId}/onboarding?s=${back}`} className="inline-flex items-center gap-1.5 min-h-11 px-3 -ml-3 rounded-full text-sm text-ink-muted hover:text-ink hover:bg-hover">
                <ArrowLeft size={15} aria-hidden="true" /> Back
              </Link>
            )}
          </div>
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-8 py-10 fade-up" key={at}>
            <div className="flex flex-col items-center gap-4 max-w-[30rem]">
              <h1 className="text-[2rem] sm:text-[2.5rem] font-medium leading-[1.1] tracking-[-0.025em] text-balance">{title}</h1>
              {sub && <p className="text-ink-muted text-base sm:text-lg leading-relaxed max-w-[36ch] text-pretty">{sub}</p>}
            </div>
            <div className="flex flex-col items-center gap-3 w-full">{actions}</div>
          </div>
          <Dots at={at} />
        </section>
        <section className="rounded-[28px] bg-field flex items-center justify-center px-4 py-8 sm:p-10 lg:px-12 lg:py-10 min-h-[24rem]">
          <div className={`w-full ${wide ? "max-w-2xl" : "max-w-lg"} fade-up`} key={at}>{panel}</div>
        </section>
      </div>
    </div>
  );
}

const cta = `${btnClass("primary", "lg")} w-full max-w-[20rem]`;
const quiet = "min-h-11 px-3 text-sm text-ink-muted underline underline-offset-4 decoration-line hover:text-ink";
const Card = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <div className={`bg-paper border border-hairline rounded-2xl p-5 sm:p-6 ${className}`}>{children}</div>
);

/** Continue: shows its own progress, and never fires twice. */
function Go({ label, busy, disabled, onClick, note }: { label: string; busy?: string | false; disabled?: boolean; onClick: () => void; note?: ReactNode }) {
  return (
    <>
      <button type="button" className={cta} disabled={disabled || !!busy} aria-busy={!!busy} onClick={onClick}>
        {busy ? <><AgentDots /> {busy}</> : label}
      </button>
      {note && <p className="text-sm text-ink-faint">{note}</p>}
    </>
  );
}

function Skip({ tenantId, to, label = "Skip for now" }: { tenantId: string; to: ScreenKey; label?: string }) {
  const [moving, go] = useTransition();
  return (
    <button type="button" className={quiet} disabled={moving} onClick={() => go(async () => { await advanceAction(tenantId, to); })}>
      {moving ? "One moment" : label}
    </button>
  );
}

// =============================================================================
// 1 · Website
// =============================================================================

export type SiteFound = { url: string; title: string; description: string; palette: string[]; fonts: string[]; logo: string | null };

const SITE_STEPS = ["Capture the address", "Read your website", "Find your brand", "Show what we found"];

export function SiteScreen({ tenantId, found: initial }: { tenantId: string; found: SiteFound | null }) {
  const [url, setUrl] = useStepDraft("site:url", initial?.url.replace(/^https?:\/\//, "").replace(/\/$/, "") ?? "");
  // -1 idle · 0–3 the step running · 4 done
  const [phase, setPhase] = useState(initial ? 4 : -1);
  const [found, setFound] = useState<SiteFound | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [moving, go] = useTransition();
  const running = phase >= 0 && phase < 4;

  const read = async () => {
    if (!url.trim() || running) return;
    setError(null);
    setFound(null);
    setPhase(0);
    await wait(350);
    setPhase(1);
    const r = await siteAction(tenantId, url);
    if (!r.ok) { setPhase(-1); setError(r.error); return; }
    setPhase(2);
    await wait(450);
    setPhase(3);
    await wait(350);
    setFound(r.value);
    setPhase(4);
  };

  return (
    <Split
      tenantId={tenantId}
      at="site"
      title={<>Help us learn your <span className="serif-accent">brand.</span></>}
      sub="Start with your website. We read what's public and fill in what we can, so you type less."
      actions={
        found ? (
          <Go label="Continue" busy={moving && "Opening"} onClick={() => go(async () => { await advanceAction(tenantId, "name"); })} />
        ) : (
          <Skip tenantId={tenantId} to="name" label="I don't have a website" />
        )
      }
      panel={
        <div className="flex flex-col gap-4">
          <form
            onSubmit={(e) => { e.preventDefault(); void read(); }}
            className="flex items-center gap-2 bg-paper border border-hairline rounded-2xl p-2 pl-5 focus-within:border-line-strong"
          >
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="yourwebsite.com"
              aria-label="Your website"
              inputMode="url"
              autoComplete="url"
              className="flex-1 min-w-0 min-h-12 bg-transparent outline-none text-lg"
            />
            <button type="submit" disabled={!url.trim() || running} className={`${btnClass("primary", "md")} shrink-0 w-32`}>
              {running ? <Loader2 size={18} className="animate-spin" aria-label="Reading" /> : found ? "Read again" : "Continue"}
            </button>
          </form>
          {error && <p role="alert" className="text-sm text-danger px-1">{error}</p>}

          {phase >= 0 && phase < 4 && (
            <Card className="grid sm:grid-cols-[1fr_1.1fr] gap-6 items-start">
              <div>
                <p className="text-lg">Analysing your website</p>
                <p className="text-sm text-ink-muted mt-1.5">Reading your brand details to set up your workspace. This takes a few moments.</p>
              </div>
              <ol className="flex flex-col gap-2" aria-live="polite">
                {SITE_STEPS.map((s, i) => (
                  <li key={s} className={`flex items-center justify-between gap-3 rounded-xl px-4 min-h-12 text-sm transition-colors ${i === phase ? "bg-hover text-ink" : i < phase ? "text-ink" : "text-ink-faint bg-field"}`}>
                    <span>{i + 1}. {s}</span>
                    {i < phase ? <Check size={16} className="text-ok" aria-label="done" /> : i === phase ? <Loader2 size={16} className="animate-spin" aria-label="working" /> : null}
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {found && phase === 4 && (
            <Card className="flex flex-col gap-4">
              <div className="flex items-start gap-4">
                {found.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={found.logo} alt="Logo from your site" className="w-14 h-14 object-contain rounded-xl border border-hairline p-1.5 bg-paper shrink-0" />
                ) : (
                  <span className="w-14 h-14 rounded-xl bg-field grid place-items-center text-xl font-medium shrink-0" aria-hidden="true">{(found.title || found.url.replace(/^https?:\/\/(www\.)?/, ""))[0]?.toUpperCase()}</span>
                )}
                <div className="min-w-0">
                  <p className="text-lg leading-snug truncate">{found.title || found.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</p>
                  <p className="text-sm text-ink-muted mt-1 line-clamp-3">{found.description || "No description on the home page. You'll add one in a moment."}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
                <span className="label-mono text-ink-faint">Colours</span>
                {found.palette.length ? (
                  <span className="flex gap-1.5">
                    {found.palette.slice(0, 6).map((c) => <span key={c} title={c} className="w-7 h-7 rounded-lg border border-hairline" style={{ background: c }} />)}
                  </span>
                ) : <span className="text-sm text-ink-muted">None found</span>}
                {found.fonts.length > 0 && <span className="text-sm text-ink-muted">· {found.fonts.slice(0, 2).join(", ")}</span>}
              </div>
              <p className="text-xs text-ink-faint flex items-center gap-1.5"><Check size={12} aria-hidden="true" /> Saved. You can change any of it on the next screens.</p>
            </Card>
          )}
        </div>
      }
    />
  );
}

// =============================================================================
// 2 · Name  ·  3 · Audience
// =============================================================================

function Field({ label, hint, from, children }: { label: string; hint?: string; from?: boolean; children: ReactNode }) {
  return (
    <label className="block text-left">
      <span className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-sm font-medium">{label}</span>
        {from && <span className="label-mono text-ink-faint">From your site</span>}
      </span>
      {children}
      {hint && <span className="block text-xs text-ink-faint mt-1.5">{hint}</span>}
    </label>
  );
}

export function NameScreen({ tenantId, saved, suggested }: {
  tenantId: string; saved: { name: string; niche: string }; suggested: { name: string; niche: string };
}) {
  const start = { name: saved.name || suggested.name, niche: saved.niche || suggested.niche };
  const [form, setForm] = useStepDraft("short:name", start);
  const [moving, go] = useTransition();
  const ready = form.name.trim() && form.niche.trim();
  return (
    <Split
      tenantId={tenantId}
      at="name"
      back="site"
      title={<>What should we <span className="serif-accent">call you?</span></>}
      sub="Your name as you sign your writing, and what you do in a line."
      actions={<Go label="Continue" busy={moving && "Saving"} disabled={!ready} onClick={() => go(async () => { await nameAction(tenantId, form); })} note={!ready ? "Both are needed to carry on." : undefined} />}
      panel={
        <Card className="flex flex-col gap-5">
          <Field label="Your name" from={!saved.name && !!suggested.name && form.name === suggested.name}>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Alex Rivera" autoComplete="name" className="field" autoFocus />
          </Field>
          <Field label="What do you do?" hint="One line is plenty. You can change it later in Brand core." from={!saved.niche && !!suggested.niche && form.niche === suggested.niche}>
            <textarea rows={2} value={form.niche} onChange={(e) => setForm({ ...form, niche: e.target.value })} placeholder="Leadership coaching for first-time managers" className="field" />
          </Field>
        </Card>
      }
    />
  );
}

export function AudienceScreen({ tenantId, saved }: { tenantId: string; saved: { audience: string; offers: string; positioning: string } }) {
  const [form, setForm] = useStepDraft("short:audience", saved);
  const [moving, go] = useTransition();
  return (
    <Split
      tenantId={tenantId}
      at="audience"
      back="name"
      title={<>Who do you <span className="serif-accent">write for?</span></>}
      sub="Who it's for and what you offer them. Every piece starts from this."
      actions={<Go label="Continue" busy={moving && "Saving"} disabled={!form.audience.trim()} onClick={() => go(async () => { await audienceAction(tenantId, form); })} />}
      panel={
        <Card className="flex flex-col gap-5">
          <Field label="Who is it for?">
            <textarea rows={2} value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} placeholder="Engineers promoted into their first management role" className="field" autoFocus />
          </Field>
          <Field label="What do you offer them?">
            <textarea rows={2} value={form.offers} onChange={(e) => setForm({ ...form, offers: e.target.value })} placeholder="1:1 coaching, a six-week cohort, team workshops" className="field" />
          </Field>
          <Field label="Why you, in one line" hint="Optional.">
            <textarea rows={2} value={form.positioning} onChange={(e) => setForm({ ...form, positioning: e.target.value })} placeholder="I help new managers stop firefighting and start leading" className="field" />
          </Field>
        </Card>
      }
    />
  );
}

// =============================================================================
// 4 · Writing
// =============================================================================

const CHANNELS: { key: string; label: string; private?: boolean; accept: string }[] = [
  { key: "linkedin", label: "LinkedIn", accept: ".csv,.txt,.md" },
  { key: "instagram", label: "Instagram", accept: ".txt,.md" },
  { key: "x", label: "X", accept: ".txt,.md" },
  { key: "threads", label: "Threads", accept: ".txt,.md" },
  { key: "newsletter", label: "Newsletter or blog", accept: ".txt,.md,.pdf,.docx" },
  { key: "email", label: "Sent email", private: true, accept: ".txt,.md" },
];
const PROMPTS = ["What you do, and why you do it.", "A story from your work that you tell often.", "Something most people in your field believe that you disagree with."];
const TARGET = 10;

export function WritingScreen({ tenantId, sources, writeFor, pieces, words, links }: {
  tenantId: string; sources: string[]; writeFor: string[]; pieces: number; words: number;
  /** Reading their own writing from a link (site, blog, Substack, Medium, podcast). */
  links: ReactNode;
}) {
  const router = useRouter();
  const known = CHANNELS.map((c) => c.key);
  const saved = sources.filter((s) => known.includes(s));
  const [picked, setPicked] = useStepDraft<string[]>("short:channels", saved.length ? saved : ["linkedin"]);
  const [active, setActive] = useState(picked[0] ?? "linkedin");
  const [pastes, setPastes] = useStepDraft<Record<string, string>>("short:pastes", {});
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [mode, setMode] = useState<"paste" | "talk" | "link">("paste");
  const [notes, setNotes] = useStepDraft("short:notes", ["", "", ""]);
  const [busy, setBusy] = useState<string | false>(false);
  const [log, setLog] = useState<string | null>(null);
  const [, go] = useTransition();
  const on = picked.includes(active) ? active : picked[0];
  const ch = CHANNELS.find((c) => c.key === on);

  const pending = picked.some((k) => (pastes[k] ?? "").trim() || (files[k] ?? []).length) || notes.some((n) => n.trim().split(/\s+/).length >= 10);
  const toggle = (k: string) => {
    const next = picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k];
    setPicked(next);
    if (!picked.includes(k)) setActive(k);
  };

  /** Everything added on this screen, read and measured: pastes, files, then the spoken answers. */
  const addAll = async (): Promise<number> => {
    const batches: { label: string; run: () => Promise<IngestedPiece[]>; source: "paste" | "upload" | "export" }[] = [];
    for (const c of CHANNELS.filter((x) => picked.includes(x.key))) {
      const vis = c.private ? "private" : "public";
      for (const f of files[c.key] ?? []) {
        batches.push({
          label: f.name,
          source: c.key === "linkedin" && f.name.toLowerCase().endsWith(".csv") ? "export" : "upload",
          run: async () => {
            if (/\.(pdf|docx)$/i.test(f.name)) {
              const body = new FormData();
              body.append("file", f);
              const res = await fetch(`/w/${tenantId}/onboarding/extract`, { method: "POST", body });
              const out = (await res.json().catch(() => ({}))) as { text?: string };
              return out.text ? ingestText(out.text, c.key, vis).pieces : [];
            }
            const text = await f.text();
            return (c.key === "linkedin" && f.name.toLowerCase().endsWith(".csv") ? ingestLinkedIn(text) : ingestText(text, c.key, vis)).pieces;
          },
        });
      }
      const paste = (pastes[c.key] ?? "").trim();
      if (paste) {
        batches.push({
          label: `${c.label} (pasted)`,
          source: "paste",
          run: async () => {
            const parts = c.key === "email" ? splitPieces(paste).map(stripEmail) : splitPieces(paste);
            return parts.map((p) => p.trim()).filter(Boolean).map((body) => ({ body, channel: c.key, visibility: vis as "public" | "private", kind: "corpus" as const }));
          },
        });
      }
    }
    let added = 0;
    if (batches.length) {
      await markIngestingAction(tenantId);
      for (const [i, b] of batches.entries()) {
        setBusy(`Reading ${i + 1} of ${batches.length}`);
        try {
          const list = await b.run();
          if (list.length) added += await ingestAction(tenantId, list, b.source);
        } catch {
          /* one unreadable file never stops the rest */
        }
      }
      setBusy("Learning how you sound");
      await finishIngestAction(tenantId);
    }
    const spoken = notes.filter((n) => n.trim().split(/\s+/).length >= 10);
    if (spoken.length) {
      setBusy("Learning how you sound");
      added += await voiceNotesAction(tenantId, notes);
    }
    // Where they post is both what we may read and where we write for them.
    const keep = (list: string[]) => list.filter((k) => !known.includes(k));
    await saveSourcesAction(tenantId, [...keep(sources), ...picked], [...keep(writeFor), ...picked]);
    setPastes({});
    setFiles({});
    setNotes(["", "", ""]);
    return added;
  };

  const add = () => go(async () => {
    const n = await addAll();
    setBusy(false);
    setLog(n ? `${n} ${n === 1 ? "piece" : "pieces"} added.` : "Nothing new to add.");
    router.refresh();
  });
  const next = () => go(async () => {
    if (pending) await addAll();
    else await saveSourcesAction(tenantId, [...sources.filter((k) => !known.includes(k)), ...picked], [...writeFor.filter((k) => !known.includes(k)), ...picked]);
    setBusy("Opening");
    await advanceAction(tenantId, "look");
  });

  const pct = Math.min(100, Math.round((pieces / TARGET) * 100));

  return (
    <Split
      tenantId={tenantId}
      at="writing"
      back="audience"
      wide
      title={<>Add some of your <span className="serif-accent">writing.</span></>}
      sub="A few real posts teach us how you sound. Paste them or upload a file; we read only what you add, and never train shared models on it."
      actions={
        <Go
          label="Continue"
          busy={busy}
          disabled={pieces === 0 && !pending}
          onClick={next}
          note={pieces === 0 && !pending ? "Add at least one piece, or answer the three questions." : undefined}
        />
      }
      panel={
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-4">
            <div>
              <p className="text-sm font-medium text-left mb-2.5">Where do you post?</p>
              <div className="flex flex-wrap gap-2">
                {CHANNELS.map((c) => (
                  <button key={c.key} type="button" aria-pressed={picked.includes(c.key)} onClick={() => toggle(c.key)}
                    className={`min-h-11 px-4 rounded-full border text-sm ${picked.includes(c.key) ? "bg-ink text-on-ink border-ink" : "bg-paper border-line hover:border-ink"}`}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="hu-seg self-start max-w-full overflow-x-auto" role="radiogroup" aria-label="How to add writing">
              {([["paste", "Paste or upload"], ["talk", "No writing yet"], ["link", "From a link"]] as const).map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)} className="hu-seg__item whitespace-nowrap">{l}</button>
              ))}
            </div>

            {mode === "paste" && ch && (
              <div className="flex flex-col gap-3">
                {picked.length > 1 && (
                  <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Which writing you're adding">
                    {CHANNELS.filter((c) => picked.includes(c.key)).map((c) => (
                      <button key={c.key} type="button" role="tab" aria-selected={on === c.key} onClick={() => setActive(c.key)}
                        className={`min-h-9 px-3 rounded-full text-xs border ${on === c.key ? "border-ink text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}>
                        {c.label}
                        {((pastes[c.key] ?? "").trim() || (files[c.key] ?? []).length) ? <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-ink align-middle" aria-label="has writing" /> : null}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  rows={7}
                  value={pastes[ch.key] ?? ""}
                  onChange={(e) => setPastes({ ...pastes, [ch.key]: e.target.value })}
                  placeholder={ch.key === "email" ? "Paste a few sent emails. Put a line with --- between them." : `Paste a few of your ${ch.label} posts. Put a line with --- between them.`}
                  aria-label={`Paste ${ch.label}`}
                  className="field text-sm"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 min-h-11 px-4 rounded-full border border-dashed border-line hover:border-ink cursor-pointer text-sm">
                    <FileUp size={15} aria-hidden="true" /> Upload files
                    <input type="file" multiple accept={ch.accept} className="sr-only" onChange={(e) => setFiles({ ...files, [ch.key]: Array.from(e.target.files ?? []) })} />
                  </label>
                  {(files[ch.key] ?? []).length > 0 && <span className="text-sm text-ink-muted truncate">{files[ch.key].map((f) => f.name).join(", ")}</span>}
                  {ch.key === "linkedin" && !(files[ch.key] ?? []).length && <span className="text-xs text-ink-faint">Shares.csv from LinkedIn&apos;s export works too.</span>}
                </div>
              </div>
            )}

            {mode === "talk" && (
              <div className="flex flex-col gap-3 text-left">
                <p className="text-sm text-ink-muted">Answer these the way you&apos;d say them out loud. A few sentences each is enough.</p>
                {PROMPTS.map((q, i) => (
                  <label key={q} className="block">
                    <span className="block text-sm font-medium mb-1.5">{q}</span>
                    <textarea rows={3} value={notes[i]} onChange={(e) => setNotes(notes.map((n, j) => (j === i ? e.target.value : n)))} className="field text-sm" />
                  </label>
                ))}
              </div>
            )}

            {mode === "link" && <div className="text-left">{links}</div>}

            {mode !== "link" && (
              <div className="flex items-center gap-3">
                <button type="button" onClick={add} disabled={!pending || !!busy} className={btnClass("secondary", "sm")}>Add these</button>
                {log && <span role="status" className="text-sm text-ok flex items-center gap-1.5"><Check size={14} aria-hidden="true" /> {log}</span>}
              </div>
            )}
          </Card>

          <div className="flex flex-col gap-2 px-1" aria-live="polite">
            <div className="flex items-baseline justify-between text-sm">
              <span><strong className="font-medium tabular-nums">{pieces}</strong> {pieces === 1 ? "piece" : "pieces"} · <span className="tabular-nums">{words.toLocaleString()}</span> words on file</span>
              <span className="text-ink-faint">{pieces >= TARGET ? "Enough to start" : `${TARGET} is a good start`}</span>
            </div>
            <div className="h-1.5 rounded-full bg-paper overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={TARGET} aria-valuenow={Math.min(pieces, TARGET)} aria-label="Writing on file">
              <div className="h-full bg-ink rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-ink-faint text-left">Rather connect Gmail or LinkedIn? <Link href="/settings/connections" className="underline underline-offset-2 hover:text-ink">Connect accounts</Link></p>
          </div>
        </div>
      }
    />
  );
}

// =============================================================================
// 5 · Look
// =============================================================================

export function LookScreen({ tenantId, references, palette, site }: {
  tenantId: string; references: { id: string; url: string }[]; palette: string[]; site: string | null;
}) {
  const router = useRouter();
  const [colours, setColours] = useStepDraft<string[]>("short:colours", [palette[0] ?? "#FFFFFF", palette[1] ?? "#0A0A0A"]);
  const [uploading, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [moving, go] = useTransition();
  const bad = colours.some((c) => !HEX.test(c));

  const upload = (file: File | undefined) => {
    if (!file) return;
    start(async () => {
      setError(null);
      const fd = new FormData();
      fd.append("tenantId", tenantId);
      fd.append("kind", "reference_image");
      fd.append("file", file);
      try {
        await uploadAssetAction(fd);
        router.refresh();
      } catch {
        setError("That file couldn't be used. Use a PNG, JPG or WebP under 5 MB.");
      }
    });
  };

  const slots = Array.from({ length: MAX_REFERENCES }, (_, i) => references[i] ?? null);
  const firstEmpty = slots.findIndex((s) => !s);

  return (
    <Split
      tenantId={tenantId}
      at="look"
      back="writing"
      wide
      title={<>Add up to 3 designs that <span className="serif-accent">look like you.</span></>}
      sub="Branded posts or ads you already like. They show the look; they're never copied."
      actions={
        <>
          <Go label="Continue" busy={moving && "Saving"} disabled={bad || uploading} onClick={() => go(async () => { await lookAction(tenantId, colours); })} />
          <Skip tenantId={tenantId} to="words" />
        </>
      }
      panel={
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            {slots.map((r, i) =>
              r ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={r.id} src={r.url} alt={`Design ${i + 1}`} className="aspect-square w-full object-cover rounded-2xl border border-hairline bg-paper" />
              ) : (
                <label
                  key={`empty-${i}`}
                  className={`aspect-square rounded-2xl border bg-paper grid place-items-center text-ink-faint transition-colors ${i === firstEmpty ? "border-line hover:border-ink hover:text-ink cursor-pointer" : "border-hairline opacity-60"}`}
                >
                  {uploading && i === firstEmpty ? <Loader2 size={20} className="animate-spin" aria-label="Uploading" /> : <Plus size={20} aria-hidden="true" />}
                  <span className="sr-only">Add a design</span>
                  {i === firstEmpty && <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={uploading} onChange={(e) => upload(e.target.files?.[0])} />}
                </label>
              ),
            )}
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}

          <Card className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium">Your colours</p>
              {site && <span className="label-mono text-ink-faint truncate">From {site.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</span>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {["Background", "Accent"].map((role, i) => (
                <div key={role} className="flex items-center gap-3 border border-hairline rounded-xl p-2.5">
                  <span className="w-11 h-11 rounded-lg border border-hairline shrink-0" style={{ background: HEX.test(colours[i]) ? colours[i] : "transparent" }} aria-hidden="true" />
                  <span className="flex flex-col min-w-0 text-left">
                    <span className="label-mono text-ink-faint">{role}</span>
                    <input
                      value={colours[i]}
                      onChange={(e) => setColours(colours.map((c, j) => (j === i ? e.target.value.trim() : c)))}
                      aria-label={`${role} colour, as hex`}
                      aria-invalid={!HEX.test(colours[i])}
                      spellCheck={false}
                      className="w-full font-mono text-sm bg-transparent outline-none min-h-8"
                    />
                  </span>
                </div>
              ))}
            </div>
            {bad && <p className="text-xs text-danger">Use six-digit hex values, like #0A0A0A.</p>}
            <p className="text-xs text-ink-faint flex items-center gap-1.5"><ImagePlus size={12} aria-hidden="true" /> Logo, fonts and photo style live in Brand core › Visual.</p>
          </Card>
        </div>
      }
    />
  );
}

// =============================================================================
// 6 · Words
// =============================================================================

export function WordsScreen({ tenantId, saved }: { tenantId: string; saved: string[] }) {
  const [picks, setPicks] = useStepDraft<string[]>("short:words", saved);
  const [moving, go] = useTransition();
  const enough = picks.length >= MIN_PICKS && picks.length <= MAX_PICKS;
  return (
    <Split
      tenantId={tenantId}
      at="words"
      back="look"
      wide
      title={<>Pick the words that <span className="serif-accent">sound like you.</span></>}
      sub={`Tap ${MIN_PICKS} to ${MAX_PICKS}. They set the tone of every draft.`}
      actions={
        <>
          <Go label="Continue" busy={moving && "Saving"} disabled={!enough} onClick={() => go(async () => { await wordsAction(tenantId, picks); })}
            note={
              /* Say what to do next, not "13 of 12 to 15 picked", which reads
                 like a broken fraction once you are past the minimum. */
              <span className="tabular-nums">
                {picks.length < MIN_PICKS
                  ? `${picks.length} picked · ${MIN_PICKS - picks.length} to go`
                  : `${picks.length} picked`}
              </span>
            } />
          <Skip tenantId={tenantId} to="draft" />
        </>
      }
      panel={
        <div className="flex flex-wrap justify-center gap-1.5">
          {WORDS.map(([w]) => {
            const on = picks.includes(w);
            return (
              <button key={w} type="button" aria-pressed={on} disabled={!on && picks.length >= MAX_PICKS}
                onClick={() => setPicks(on ? picks.filter((p) => p !== w) : [...picks, w])}
                className={`min-h-11 px-3.5 rounded-full border text-sm transition-colors disabled:opacity-40 ${on ? "bg-ink text-on-ink border-ink" : "bg-paper border-hairline hover:border-ink"}`}>
                {w}
              </button>
            );
          })}
        </div>
      }
    />
  );
}

// =============================================================================
// 7 · First piece
// =============================================================================

export function DraftScreen({ tenantId, name, first, state }: {
  tenantId: string;
  name: string;
  first: { id: string; hook: string | null; body: string | null; cta: string | null; score: number | null; band: string | null } | null;
  /** The write in flight or failed, from the server checkpoint. */
  state: "writing" | "failed" | null;
}) {
  const router = useRouter();
  const [writing, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const has = !!first?.body;

  const write = () => start(async () => {
    setError(null);
    try {
      await firstPieceAction(tenantId);
    } catch {
      setError("The first piece didn't come through. Try again.");
    }
    router.refresh();
  });

  // Written once, as the screen opens; a reload mid-write waits for the same piece.
  useEffect(() => {
    if (started.current || has || state === "failed") return;
    started.current = true;
    if (state === "writing") {
      const t = setInterval(() => router.refresh(), 3000);
      return () => clearInterval(t);
    }
    write();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = !has && (writing || state === "writing");

  return (
    <Split
      tenantId={tenantId}
      at="draft"
      back="words"
      title={<>Here&apos;s your first <span className="serif-accent">piece.</span></>}
      sub="Written in your voice, from your writing and your words. Change anything; every edit teaches it."
      actions={
        <>
          <form action={finishOnboardingAction} className="w-full flex justify-center">
            <input type="hidden" name="tenantId" value={tenantId} />
            <button type="submit" className={cta} disabled={busy}>Yes, that&apos;s me. Open my studio</button>
          </form>
          {has && first && <Link href={`/w/${tenantId}/p/${first.id}/content`} className={quiet}>Edit it first</Link>}
        </>
      }
      panel={
        <Card className="flex flex-col gap-4 text-left">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-full bg-ink text-on-ink grid place-items-center text-sm font-medium shrink-0" aria-hidden="true">
              {name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "Y"}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{name || "You"}</p>
              <p className="text-xs text-ink-faint">Draft · not posted</p>
            </div>
          </div>
          {busy && (
            <div className="flex flex-col gap-2.5" role="status" aria-live="polite">
              <p className="text-sm text-ink-muted flex items-center gap-2"><AgentDots /> Writing in your voice</p>
              {[92, 100, 78, 96, 64].map((w, i) => <span key={i} className="h-3 rounded-full bg-field animate-pulse" style={{ width: `${w}%` }} />)}
            </div>
          )}
          {!busy && has && first && (
            <>
              <div className="flex flex-col gap-3 text-[0.95rem] leading-relaxed max-h-[22rem] overflow-y-auto pr-1">
                {first.hook && <p className="font-semibold">{first.hook}</p>}
                {first.body?.split(/\n{2,}/).map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>)}
                {first.cta && <p className="text-ink-muted">{first.cta}</p>}
              </div>
              {first.score != null && <div className="border-t border-hairline pt-4"><ScoreMeter score={first.score} band={first.band === "on_brand" ? "on" : first.band === "drifting" ? "drift" : "off"} /></div>}
            </>
          )}
          {!busy && !has && (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-ink-muted flex items-center gap-2"><Circle size={14} aria-hidden="true" /> {error ?? (state === "failed" ? "The first piece didn't come through." : "No piece yet.")}</p>
              <button type="button" onClick={write} className={btnClass("secondary", "sm")}>Write it</button>
            </div>
          )}
        </Card>
      }
    />
  );
}
