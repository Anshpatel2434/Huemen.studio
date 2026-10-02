"use client";

/**
 * Onboarding steps 0, 1, 2 and 4 (step 3 is mostly a server form).
 *
 * Step 1 reads files in the browser, strips private sources there, and sends
 * one file at a time so the progress shown is real: "Ingesting" is determinate
 * per file, "Learning" is the re-measure after (design system §15.2).
 *
 * Anything typed or picked and not yet saved is a draft (`useStepDraft`), so a
 * reload puts it back; saved answers come back from the server.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { ArrowLeft, Check, FileUp, Lock, Mic, AlertTriangle, CheckCircle2, Circle, History, X } from "lucide-react";
import { btnClass } from "@/components/btn";
import { AgentDots, Badge } from "@/components/ui";
import { ScoreMeter } from "@/components/composites";
import {
  SOURCE_GROUPS, ingestLinkedIn, ingestText, ingestWhatsApp, stripEmail, type IngestedPiece,
} from "@/lib/voice/ingest";
import { PLATFORM_RULES } from "@/lib/voice/platforms";
import { DEFAULT_FOLLOW_UP, isGeneric, type Question } from "@/lib/voice/questions";
import { WORDS, MIN_PICKS, MAX_PICKS, groupPicks } from "@/lib/voice/words";
import { DIAL_KEYS, DIAL_LABELS, WORK_MODES, type DialKey, type WorkMode } from "@/lib/voice/types";
import type { ConfirmCard } from "@/lib/voice/derive";
import type { Prefill } from "@/lib/voice/lifecycle";
import { VoiceRecorder } from "@/components/voice-recorder";
import { parseCaptions } from "@/lib/integrations/text";
import { InfluencesEditor, LanguagesEditor, ThisOrThat } from "./enrich-ui";
import type { LanguageMix } from "@/lib/voice/types";
import {
  aboutAction, answerAction, benchmarksAction, cardAction, dialsAction, dropOpenerAction, finishIngestAction, firstPieceAction,
  goToStepAction, guardrailAction, ingestAction, markIngestingAction, neverWordsAction, ownDraftForFirstPieceAction,
  resumeIngestAction, saveSourcesAction, voiceNotesAction, workModeAction,
} from "./actions";
import { clearOnboardingDrafts, pendingDrafts, useDraftPrefix, useStepDraft } from "./draft";

/** Back one step: a plain link, so it works mid-save and never loses a draft. */
export function BackStep({ tenantId, to, label }: { tenantId: string; to: number; label: string }) {
  return (
    <Link href={`/w/${tenantId}/onboarding?step=${to}`} className={btnClass("secondary")}>
      <ArrowLeft size={15} aria-hidden="true" /> {label}
    </Link>
  );
}

/** Shown once when a reload gave back unsaved work, so nobody wonders where it came from. */
function RestoredNote({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <p role="status" className="text-[0.82rem] text-ink-muted flex items-center gap-1.5">
      <History size={13} aria-hidden="true" /> We kept what you hadn&apos;t saved yet.
    </p>
  );
}

const Section = ({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) => (
  <section className="bg-paper border border-hairline rounded-[12px] p-5 flex flex-col gap-4">
    <div>
      <h2 className="text-[1.05rem]">{title}</h2>
      {sub && <p className="text-[0.88rem] text-ink-muted mt-1">{sub}</p>}
    </div>
    {children}
  </section>
);

/** A row-sized target: the whole label is the control (design system §10). */
const Choice = ({ on, onToggle, children, radio }: { on: boolean; onToggle: () => void; children: ReactNode; radio?: boolean }) => (
  <label className={`flex items-start gap-2.5 min-h-11 px-3 py-2.5 rounded-[8px] border cursor-pointer text-[0.88rem] ${on ? "border-ink bg-field" : "border-hairline hover:border-line"}`}>
    <input type={radio ? "radio" : "checkbox"} checked={on} onChange={onToggle} className="mt-0.5 accent-[var(--ink)]" />
    <span className="flex-1">{children}</span>
  </label>
);

// =============================================================================
// Step 0 — About you
// =============================================================================

type AboutForm = { name: string; niche: string; audience: string; offers: string; positioning: string };

const ABOUT_FIELDS: { key: keyof AboutForm; label: string; hint: string; rows?: number; required?: boolean }[] = [
  { key: "name", label: "Your name, as you sign your writing", hint: "Alex Rivera", required: true },
  { key: "niche", label: "What do you do?", hint: "Leadership coaching for first-time managers", required: true },
  { key: "audience", label: "Who is it for?", hint: "Engineers promoted into their first management role", rows: 2 },
  { key: "offers", label: "What do you offer them?", hint: "1:1 coaching, a six-week cohort, team workshops", rows: 2 },
  { key: "positioning", label: "In one line, why you? (optional)", hint: "I help new managers stop firefighting and start leading", rows: 2 },
];

export function AboutStep({ tenantId, saved, returning }: { tenantId: string; saved: AboutForm; returning: boolean }) {
  const [form, setForm, draft] = useStepDraft<AboutForm>("about", saved);
  const [pending, start] = useTransition();
  const missing = ABOUT_FIELDS.filter((f) => f.required && !form[f.key].trim());

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[1.9rem]">{returning ? <>Welcome <span className="serif-accent">back.</span></> : <>Let&apos;s set up your <span className="serif-accent">brand.</span></>}</h1>
        <p className="text-ink-muted mt-2 max-w-[62ch]">
          Five short steps, about fifteen minutes. You tell us who you are, we read some of your writing, and you leave with a first piece in your own voice.
          Everything saves as you go: leave at any point and you&apos;ll come back to the same place.
        </p>
      </div>

      <Section title="About you" sub="The basics every piece starts from. You can change any of it later in Brand core.">
        <RestoredNote on={draft.restored} />
        {ABOUT_FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="block text-[0.88rem] font-medium mb-1.5">{f.label}</span>
            {f.rows ? (
              <textarea rows={f.rows} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} placeholder={f.hint} className="field" />
            ) : (
              <input value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} placeholder={f.hint} required={f.required} autoComplete={f.key === "name" ? "name" : "off"} className="field" />
            )}
          </label>
        ))}
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || missing.length > 0}
          aria-busy={pending}
          onClick={() => start(async () => { await aboutAction(tenantId, form); })}
          className={btnClass("primary")}
        >
          {pending ? <><AgentDots /> Saving</> : "Continue to add your writing"}
        </button>
        {missing.length > 0 && <span className="text-[0.82rem] text-ink-faint">Add {missing.map((m) => (m.key === "name" ? "your name" : "what you do")).join(" and ")} to carry on.</span>}
      </div>
    </div>
  );
}

// =============================================================================
// Step 1 — Add samples
// =============================================================================

const WRITE_FOR = ["linkedin", "linkedin_comment", "instagram", "x", "threads", "newsletter", "email", "whatsapp", "slack", "spoken", "bio"];

interface Batch { label: string; run: () => Promise<{ pieces: IngestedPiece[]; summary: string }>; source: "paste" | "upload" | "export" }

export function SamplesStep({ tenantId, sources, writeFor, pieces, words, level, canRecord, links, stalled }: {
  tenantId: string; sources: string[]; writeFor: string[]; pieces: number; words: number; level: string; canRecord: boolean;
  /** Reading their own writing from links (site, blog, Substack, Medium, podcast). */
  links?: ReactNode;
  /** A batch was cut off by a reload: what arrived is saved, not yet measured. */
  stalled?: boolean;
}) {
  const router = useRouter();
  const savedPlatforms = writeFor.length ? writeFor : ["linkedin"];
  const [picked, setPicked, pickedDraft] = useStepDraft<string[]>("sources", sources);
  const [platforms, setPlatforms] = useStepDraft<string[]>("writeFor", savedPlatforms);
  const [files, setFiles] = useState<Record<string, File[]>>({});
  // A File can't be stored, but its name can: after a reload we say which to choose again.
  const [fileNames, setFileNames] = useStepDraft<Record<string, string[]>>("files", {});
  const [pastes, setPastes, pastesDraft] = useStepDraft<Record<string, string>>("pastes", {});
  const [waName, setWaName] = useStepDraft("waName", "");
  const [progress, setProgress] = useState<{ done: number; total: number; phase: "ingesting" | "learning" | "done"; log: string[] } | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const [notes, setNotes] = useStepDraft("notes", ["", "", ""]);
  const [resuming, setResuming] = useState(false);
  const resumed = useRef(false);

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const allSources = SOURCE_GROUPS.flatMap((g) => g.sources.map((s) => ({ ...s, private: g.private })));
  const chosen = allSources.filter((s) => picked.includes(s.key));
  const choicesDirty = JSON.stringify([...picked].sort()) !== JSON.stringify([...sources].sort())
    || JSON.stringify([...platforms].sort()) !== JSON.stringify([...savedPlatforms].sort());

  const save = () => start(async () => { await saveSourcesAction(tenantId, picked, platforms); setSaved(true); router.refresh(); });

  // An upload cut off by a reload: measure what landed, once, then say so.
  useEffect(() => {
    if (!stalled || resumed.current) return;
    resumed.current = true;
    setResuming(true);
    resumeIngestAction(tenantId).finally(() => { setResuming(false); router.refresh(); });
  }, [stalled, tenantId, router]);

  // Continuing saves the choices first, so "where we write for you" is never lost
  // to someone who skipped the Save button.
  const next = () => start(async () => {
    if (choicesDirty) await saveSourcesAction(tenantId, picked, platforms);
    await goToStepAction(tenantId, 2);
  });

  const batches = (): Batch[] => {
    const out: Batch[] = [];
    for (const s of chosen) {
      const vis = s.private ? "private" : "public";
      for (const f of files[s.key] ?? []) {
        out.push({
          label: f.name,
          source: s.key === "linkedin" || s.key === "whatsapp" ? "export" : "upload",
          run: async () => {
            const text = await f.text();
            if (s.key === "linkedin" && f.name.toLowerCase().endsWith(".csv")) return ingestLinkedIn(text);
            if (s.key === "whatsapp") return ingestWhatsApp(text, waName);
            // Caption files from YouTube Studio, a podcast host or a talk recording.
            if (/\.(vtt|srt)$/i.test(f.name)) {
              const body = parseCaptions(text);
              return {
                pieces: body ? [{ body, channel: s.channel, visibility: vis as "public" | "private", kind: "corpus" as const }] : [],
                summary: body ? `${body.split(/\s+/).length} spoken words read.` : "No words found in that caption file.",
              };
            }
            return ingestText(text, s.channel, vis);
          },
        });
      }
      const paste = (pastes[s.key] ?? "").trim();
      if (paste) {
        out.push({
          label: `${s.label} (pasted)`,
          source: "paste",
          run: async () => {
            // A paste separates pieces with a blank line; emails are stripped
            // of quoted replies and signatures before anything is sent.
            const parts = s.key === "email" ? paste.split(/^\s*---\s*$/m).map(stripEmail) : paste.split(/\n\s*\n/);
            const bodies = parts.map((p) => p.trim()).filter(Boolean);
            return {
              pieces: bodies.map((body) => ({ body, channel: s.channel, visibility: vis as "public" | "private", kind: "corpus" as const })),
              summary: `${bodies.length} pasted ${bodies.length === 1 ? "piece" : "pieces"} read.`,
            };
          },
        });
      }
    }
    return out;
  };

  const ingest = () => start(async () => {
    const list = batches();
    if (!list.length) return;
    const log: string[] = [];
    setProgress({ done: 0, total: list.length, phase: "ingesting", log });
    await markIngestingAction(tenantId);
    for (const [i, b] of list.entries()) {
      try {
        const r = await b.run();
        const added = r.pieces.length ? await ingestAction(tenantId, r.pieces, b.source) : 0;
        log.push(`${b.label}: ${r.summary}${added < r.pieces.length ? ` ${r.pieces.length - added} already on file.` : ""}`);
      } catch {
        log.push(`${b.label}: could not be read. Export it as plain text and try again.`);
      }
      setProgress({ done: i + 1, total: list.length, phase: "ingesting", log: [...log] });
    }
    setProgress({ done: list.length, total: list.length, phase: "learning", log: [...log] });
    const r = await finishIngestAction(tenantId);
    log.push(`Your core now reads ${r.pieces} pieces, ${r.words.toLocaleString()} words.`);
    setProgress({ done: list.length, total: list.length, phase: "done", log: [...log] });
    setFiles({});
    setFileNames({});
    setPastes({});
    router.refresh();
  });

  const thin = level === "empty" || level === "thin";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[1.9rem]">Add your <span className="serif-accent">writing.</span></h1>
        <p className="text-ink-muted mt-2 max-w-[62ch]">Real writing is most of what makes a draft sound like you. Pick where you write, then add some of it. Uploads and pastes only for now: nothing is read from an account.</p>
      </div>

      {resuming && (
        <p role="status" className="text-[0.88rem] bg-field rounded-[10px] px-4 py-3 flex items-center gap-2">
          <AgentDots /> Picking up where you left off: measuring the writing that arrived before the page reloaded.
        </p>
      )}
      <RestoredNote on={(pickedDraft.restored && choicesDirty) || (pastesDraft.restored && Object.values(pastes).some((p) => p.trim()))} />

      <Section title="Where do you write?" sub="Pick everything you're happy for us to read. We read only what you pick.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          {SOURCE_GROUPS.map((g) => (
            <fieldset key={g.group} className="flex flex-col gap-2">
              <legend className="label-mono text-ink-faint mb-1 flex items-center gap-1.5">{g.group}{g.private && <Lock size={11} aria-hidden="true" />}</legend>
              {g.sources.map((s) => (
                <Choice key={s.key} on={picked.includes(s.key)} onToggle={() => setPicked(toggle(picked, s.key))}>{s.label}</Choice>
              ))}
            </fieldset>
          ))}
        </div>
        {picked.some((k) => ["email", "linkedin", "documents", "newsletter"].includes(k)) && (
          <p className="text-[0.85rem] bg-accent-soft rounded-[8px] px-3 py-2.5">
            Rather connect than export? Gmail, Google Docs and LinkedIn can be connected directly, reading only what you allow.{" "}
            <Link href="/settings/connections" className="text-accent underline underline-offset-2">Connect accounts in Settings</Link>
          </p>
        )}
        <p className="text-[0.8rem] text-ink-muted flex items-start gap-2 bg-field rounded-[8px] px-3 py-2.5">
          <Lock size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          We'll read only what you pick, to learn how you sound. We never train shared models on your writing, and you can remove any source any time. From email and chat we keep only what you wrote; other people's words are removed before anything is stored, and your private writing is measured but never quoted in a draft.
        </p>
      </Section>

      <Section title="Where should we write for you?" sub="Each one gets its own block in your voice. It's marked measured once we've read five of your pieces from it.">
        <div className="flex flex-wrap gap-2">
          {WRITE_FOR.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={platforms.includes(p)}
              onClick={() => setPlatforms(toggle(platforms, p))}
              className={`min-h-11 px-4 rounded-full border text-[0.85rem] ${platforms.includes(p) ? "bg-ink text-on-ink border-ink" : "border-line hover:border-ink"}`}
            >
              {PLATFORM_RULES[p]?.label ?? p}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={pending} className={btnClass("primary", "sm")}>{pending && !progress ? <AgentDots /> : null} Save choices</button>
          {saved && <span className="text-[0.85rem] text-ok flex items-center gap-1.5"><Check size={14} aria-hidden="true" /> Saved</span>}
        </div>
      </Section>

      {chosen.length > 0 && (
        <Section title="Add your writing" sub={<>You have <strong>{pieces}</strong> {pieces === 1 ? "piece" : "pieces"} ({words.toLocaleString()} words) on file. Ten pieces, or 1,000 words, is the minimum; around thirty is when the rarer habits become reliable.</>}>
          <div className="flex flex-col gap-5">
            {chosen.map((s) => (
              <div key={s.key} className="flex flex-col gap-2 border-t border-hairline pt-4 first:border-0 first:pt-0">
                <p className="text-[0.92rem] font-medium flex items-center gap-2">{s.label} {s.private && <Badge>private</Badge>}</p>
                <p className="text-[0.8rem] text-ink-muted">{s.how}</p>
                {s.key === "whatsapp" && (
                  <label className="block max-w-sm">
                    <span className="block text-[0.8rem] font-medium mb-1">Your name exactly as the chat shows it</span>
                    <input value={waName} onChange={(e) => setWaName(e.target.value)} className="field" />
                  </label>
                )}
                <label className="flex items-center gap-2 min-h-11 w-fit px-3 rounded-[8px] border border-dashed border-line hover:border-ink cursor-pointer text-[0.85rem]">
                  <FileUp size={15} aria-hidden="true" /> Choose files
                  <input
                    type="file"
                    multiple
                    accept={s.key === "linkedin" ? ".csv,.txt,.md" : s.key === "spoken" ? ".txt,.md,.vtt,.srt" : ".txt,.md"}
                    className="sr-only"
                    onChange={(e) => {
                      const list = Array.from(e.target.files ?? []);
                      setFiles({ ...files, [s.key]: list });
                      setFileNames({ ...fileNames, [s.key]: list.map((f) => f.name) });
                    }}
                  />
                </label>
                {(files[s.key] ?? []).length > 0 && (
                  <ul className="text-[0.8rem] text-ink-muted">{files[s.key].map((f) => <li key={f.name}>{f.name} · {(f.size / 1024).toFixed(0)} KB</li>)}</ul>
                )}
                {!(files[s.key] ?? []).length && (fileNames[s.key] ?? []).length > 0 && (
                  <p className="text-[0.8rem] text-warn flex items-start gap-1.5">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                    Before the page reloaded you&apos;d chosen {fileNames[s.key].join(", ")}. Files can&apos;t be kept by the browser, so choose them again.
                  </p>
                )}
                {s.key !== "whatsapp" && (
                  <textarea
                    rows={3}
                    value={pastes[s.key] ?? ""}
                    onChange={(e) => setPastes({ ...pastes, [s.key]: e.target.value })}
                    placeholder={s.key === "email" ? "Paste sent emails. Separate each with a line of ---" : "Or paste. A blank line starts a new piece."}
                    className="field text-[0.88rem]"
                    aria-label={`Paste ${s.label}`}
                  />
                )}
              </div>
            ))}
          </div>

          {progress && (
            <div role="status" aria-live="polite" className="flex flex-col gap-2 bg-field rounded-[8px] p-3">
              <p className="text-[0.85rem] font-medium flex items-center gap-2">
                {progress.phase === "ingesting" && <>Reading your writing · {progress.done} of {progress.total}</>}
                {progress.phase === "learning" && <><AgentDots /> Building your core</>}
                {progress.phase === "done" && <><CheckCircle2 size={15} className="text-ok" aria-hidden="true" /> Core updated</>}
              </p>
              <div className="h-1.5 rounded-full bg-paper overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.phase === "learning" ? undefined : progress.done}>
                <div className={`h-full bg-ink transition-all duration-300 ${progress.phase === "learning" ? "w-full animate-pulse" : ""}`} style={progress.phase === "learning" ? undefined : { width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
              </div>
              <ul className="text-[0.78rem] text-ink-muted flex flex-col gap-0.5">{progress.log.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={ingest} disabled={pending} className={btnClass("primary")}>{pending && progress ? <AgentDots /> : null} Add and measure</button>
          </div>
        </Section>
      )}

      {links}

      {thin && (
        <Section
          title="Not much writing yet?"
          sub="No problem. Answer these three out loud, about two minutes each: record a voice note, or type it. You'll see the words before anything is kept."
        >
          {["What you do, and why you do it.", "A story from your work that you tell often.", "Something most people in your field believe that you disagree with."].map((q, i) => (
            <label key={q} className="block">
              <span className="block text-[0.88rem] font-medium mb-1.5 flex items-center gap-1.5"><Mic size={14} aria-hidden="true" /> {q}</span>
              <textarea rows={4} value={notes[i]} onChange={(e) => setNotes(notes.map((n, j) => (j === i ? e.target.value : n)))} className="field" />
              <span className="block mt-2">
                <VoiceRecorder tenantId={tenantId} enabled={canRecord} onText={(t) => setNotes((ns) => ns.map((n, j) => (j === i ? (n.trim() ? `${n.trim()}\n\n${t}` : t) : n)))} />
              </span>
            </label>
          ))}
          <div>
            <button
              type="button"
              disabled={pending || notes.every((n) => n.trim().split(/\s+/).length < 10)}
              onClick={() => start(async () => { await voiceNotesAction(tenantId, notes); setNotes(["", "", ""]); router.refresh(); })}
              className={btnClass("secondary", "sm")}
            >
              Add these as spoken samples
            </button>
          </div>
        </Section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <BackStep tenantId={tenantId} to={0} label="About you" />
        <button type="button" onClick={next} disabled={pieces === 0 || pending} aria-busy={pending && !progress} className={btnClass("primary")}>
          {pending && !progress ? <AgentDots /> : null} Continue to confirm your voice
        </button>
        {pieces === 0 && <span className="text-[0.82rem] text-ink-faint">Add at least one piece first.</span>}
      </div>
    </div>
  );
}

// =============================================================================
// Step 2 — Confirm your voice
// =============================================================================

function useSaver() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string[]>([]);
  const run = (key: string, fn: () => Promise<unknown>) =>
    start(async () => { await fn(); setDone((d) => [...d, key]); router.refresh(); });
  return { pending, done, run };
}

export function ConfirmStep(props: {
  tenantId: string;
  cards: ConfirmCard[];
  dials: Partial<Record<DialKey, number>>;
  estimated: Partial<Record<DialKey, number>>;
  longlist: string[];
  fourWords: string[];
  answered: string[];
  current: Record<string, string | string[]>;
  prefills: Record<string, Prefill>;
  canRecord: boolean;
  influences: { admire: string[]; avoid: string[] };
  languages: LanguageMix | null;
  /** The pre-fill pass: starts itself when there's something new to read. */
  suggestions: ReactNode;
  candidates: { id: string; text: string; channel: string }[];
  benchmarks: string[];
  questions: Question[];
}) {
  const { tenantId } = props;
  const { pending, done, run } = useSaver();
  const prefix = useDraftPrefix();
  const [unsaved, setUnsaved] = useState<number | null>(null);
  const [moving, go] = useTransition();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[1.9rem]">Confirm your <span className="serif-accent">voice.</span></h1>
        <p className="text-ink-muted mt-2 max-w-[62ch]">Some of this we measured; some only you can tell us. Every answer saves on its own, so do as much as you like and come back for the rest.</p>
      </div>

      {props.cards.length > 0 && (
        <Section title="What we found" sub="Up to three things the measurements raised. The rest wait for later.">
          {props.cards.map((c) => <CardView key={c.id} tenantId={tenantId} card={c} />)}
        </Section>
      )}

      {props.suggestions}

      <ThisOrThat tenantId={tenantId} done={props.answered.includes("C4")}>
        <Dials tenantId={tenantId} dials={props.dials} estimated={props.estimated} />
      </ThisOrThat>

      <Words tenantId={tenantId} longlist={props.longlist} fourWords={props.fourWords} />

      <Section title="Your reader and your lines" sub="Answers save one at a time. A short or very general answer gets one follow-up, once.">
        {props.questions.map((q) => (
          <QuestionField key={q.id} tenantId={tenantId} q={q} initial={props.current[q.id] ?? ""} answered={props.answered.includes(q.id) || done.includes(q.id)} prefill={props.prefills[q.id]} canRecord={props.canRecord} />
        ))}
      </Section>

      <InfluencesEditor tenantId={tenantId} initial={props.influences} />
      <LanguagesEditor tenantId={tenantId} initial={props.languages} />

      {props.candidates.length >= 3 && (
        <Benchmarks tenantId={tenantId} candidates={props.candidates} initial={props.benchmarks} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <BackStep tenantId={tenantId} to={1} label="Your writing" />
        <button
          type="button"
          disabled={pending || moving}
          aria-busy={moving}
          onClick={() => {
            // Each answer here saves on its own button. Moving on with one typed
            // but not saved keeps it as a draft that no piece reads: say so, once.
            const n = prefix ? pendingDrafts(prefix, /^(q:|dials$|words$|fourWords$|benchmarks$|influences$|lang:)/) : 0;
            if (n > 0 && unsaved == null) return setUnsaved(n);
            go(async () => { await goToStepAction(tenantId, 3); });
          }}
          className={btnClass("primary")}
        >
          {moving ? <AgentDots /> : null} {unsaved ? "Continue anyway" : "Continue to set your hue"}
        </button>
      </div>
      {unsaved != null && unsaved > 0 && (
        <p role="alert" className="text-[0.85rem] text-warn flex items-start gap-1.5 -mt-3">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {unsaved === 1
            ? "One answer above isn't saved yet. It'll wait for you here, but nothing is written from it until you press its Save."
            : `${unsaved} answers above aren't saved yet. They'll wait for you here, but nothing is written from them until you press their Save.`}
        </p>
      )}
    </div>
  );
}

function CardView({ tenantId, card }: { tenantId: string; card: ConfirmCard }) {
  const { pending, done, run } = useSaver();
  const [drop, setDrop] = useState<string[]>([]);
  if (done.length) return <p className="text-[0.85rem] text-ok flex items-center gap-2"><Check size={14} aria-hidden="true" /> Saved.</p>;
  return (
    <div className="border border-hairline rounded-[10px] p-4 flex flex-col gap-3">
      <p className="text-[0.92rem] font-medium">{card.title}</p>
      <p className="text-[0.85rem] text-ink-muted">{card.body}</p>
      {card.items && card.kind === "H4" && (
        <div className="flex flex-col gap-1.5">
          {card.items.map((it) => (
            <Choice key={it.id} on={drop.includes(it.id)} onToggle={() => setDrop(drop.includes(it.id) ? drop.filter((d) => d !== it.id) : [...drop, it.id])}>
              <span className="italic">“{it.text}”</span>
            </Choice>
          ))}
        </div>
      )}
      {card.items && card.kind === "H3" && (
        <ul className="text-[0.82rem] text-ink-muted flex flex-col gap-1">{card.items.map((it) => <li key={it.id} className="italic">“{it.text}”</li>)}</ul>
      )}
      <div className="flex flex-wrap gap-2">
        {card.options.map((o, i) => (
          <button key={o.key} type="button" disabled={pending} onClick={() => run(o.key, () => cardAction(tenantId, card.id, o.key, drop))} className={btnClass(i === 0 ? "primary" : "secondary", "sm")}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Dials({ tenantId, dials, estimated }: { tenantId: string; dials: Partial<Record<DialKey, number>>; estimated: Partial<Record<DialKey, number>> }) {
  const { pending, done, run } = useSaver();
  const [v, setV, draft] = useStepDraft<Partial<Record<DialKey, number>>>(
    "dials",
    Object.fromEntries(DIAL_KEYS.map((k) => [k, dials[k] ?? estimated[k] ?? 5])) as Partial<Record<DialKey, number>>,
  );
  return (
    <Section title="The dials" sub="We've pre-set the ones your writing speaks to. Move anything that feels wrong; moving one far from your writing asks which to write like.">
      <RestoredNote on={draft.restored} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
        {DIAL_KEYS.map((k) => {
          const [l, r] = DIAL_LABELS[k];
          return (
            <label key={k} className="block">
              <span className="flex justify-between text-[0.8rem] text-ink-muted mb-1.5">
                <span>{l}</span>
                <span className="font-mono text-ink">{v[k]}{estimated[k] != null && <span className="text-ink-faint"> · from your writing: {estimated[k]}</span>}</span>
                <span>{r}</span>
              </span>
              <input type="range" min={1} max={10} step={1} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} className="w-full accent-[var(--ink)] min-h-11" aria-label={`${l} to ${r}`} />
            </label>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" disabled={pending} onClick={() => run("dials", () => dialsAction(tenantId, v))} className={btnClass("secondary", "sm")}>Save dials</button>
        {done.includes("dials") && <span className="text-[0.85rem] text-ok flex items-center gap-1.5"><Check size={14} aria-hidden="true" /> Saved</span>}
      </div>
    </Section>
  );
}

function Words({ tenantId, longlist, fourWords }: { tenantId: string; longlist: string[]; fourWords: string[] }) {
  const { pending, done, run } = useSaver();
  const [picks, setPicks] = useStepDraft<string[]>("words", longlist);
  const [keep, setKeep] = useStepDraft<Record<string, string>>("fourWords", {});
  const groups = useMemo(() => groupPicks(longlist.length ? longlist : []), [longlist]);
  const enough = picks.length >= MIN_PICKS && picks.length <= MAX_PICKS;

  return (
    <Section title="Your words" sub={`Tap every word that sounds like you. Pick ${MIN_PICKS} to ${MAX_PICKS}.`}>
      <div className="flex flex-wrap gap-1.5">
        {WORDS.map(([w]) => {
          const on = picks.includes(w);
          return (
            <button key={w} type="button" aria-pressed={on} disabled={!on && picks.length >= MAX_PICKS}
              onClick={() => setPicks(on ? picks.filter((p) => p !== w) : [...picks, w])}
              className={`min-h-11 px-3.5 rounded-full border text-[0.82rem] disabled:opacity-45 ${on ? "bg-ink text-on-ink border-ink" : "border-line hover:border-ink"}`}>
              {w}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" disabled={pending || !enough} onClick={() => run("C5", () => answerAction(tenantId, "C5", picks))} className={btnClass("secondary", "sm")}>Save {picks.length} words</button>
        <span className="text-[0.8rem] text-ink-faint tabular-nums">{picks.length} picked</span>
      </div>

      {groups.length > 0 && (
        <div className="border-t border-hairline pt-4 flex flex-col gap-4">
          <p className="text-[0.92rem] font-medium">Keep the one strongest word from each family</p>
          {groups.map((g) => (
            <fieldset key={g.family} className="flex flex-col gap-1.5">
              <legend className="label-mono text-ink-faint mb-1">{g.label}</legend>
              <div className="flex flex-wrap gap-1.5">
                {g.words.map((w) => (
                  <Choice key={w} radio on={(keep[g.family] ?? fourWords.find((f) => g.words.includes(f))) === w} onToggle={() => setKeep({ ...keep, [g.family]: w })}>{w}</Choice>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="flex items-center gap-3">
            <button type="button" disabled={pending}
              onClick={() => run("C6", async () => {
                await answerAction(tenantId, "C6", groups.map((g) => keep[g.family] ?? fourWords.find((f) => g.words.includes(f)) ?? g.words[0]));
                setKeep({}); // saved: the radios now read the four words from the server
              })}
              className={btnClass("secondary", "sm")}>Save my four words</button>
            {(done.includes("C6") || fourWords.length > 0) && <span className="text-[0.85rem] text-ink-muted">Current: {fourWords.join(", ") || "none yet"}</span>}
          </div>
        </div>
      )}
    </Section>
  );
}

/**
 * One question, in whichever of the bank's formats it uses. Shared by
 * onboarding (Core) and the Voice page (the Deep drip).
 */
export function QuestionField({ tenantId, q, initial = "", answered = false, keys, prefill, canRecord = false }: {
  tenantId: string; q: Question; initial?: string | string[]; answered?: boolean;
  /** Labels for a `shorts` question when it has no prompts (C7: their four words). */
  keys?: string[];
  /** An answer we already have: offered as a one-tap confirm, not a blank box. */
  prefill?: Prefill;
  canRecord?: boolean;
}) {
  const { pending, done, run: runSave } = useSaver();
  const [editingState, setEditing] = useState(false);
  const [value, setValue, valueDraft] = useStepDraft<string>(`q:${q.id}:text`, Array.isArray(initial) ? "" : initial);
  const [chips, setChips, chipsDraft] = useStepDraft<string[]>(`q:${q.id}:chips`, Array.isArray(initial) ? initial : []);
  const shortKeys = q.prompts ?? keys ?? [];
  const [shorts, setShorts, shortsDraft] = useStepDraft<Record<string, string>>(`q:${q.id}:shorts`, {});
  const [followed, setFollowed] = useState(false);
  // An unsaved answer that came back after a reload opens the box, not the summary.
  const restored = valueDraft.restored || chipsDraft.restored || shortsDraft.restored;
  const editing = editingState || restored;
  // Once saved, the server has it: the drafts go.
  const run = (key: string, fn: () => Promise<unknown>) =>
    runSave(key, async () => { await fn(); valueDraft.discard(); chipsDraft.discard(); shortsDraft.discard(); });
  const saved = done.includes(q.id) || (answered && !followed);
  const empty =
    q.format === "chips" || q.format === "multi" ? chips.length === 0
    : q.format === "shorts" ? !Object.values(shorts).some((v) => v.trim())
    : !value.trim();

  const shown = prefill?.value ?? initial;
  const asText = (v: string | string[]) => (Array.isArray(v) ? v.join(", ") : v);

  // Answered already, or answerable in one tap: show the answer, not the box.
  if (!editing && (prefill || (answered && asText(initial).trim())) && !followed) {
    const kept = done.includes(q.id) || answered;
    return (
      <div className="flex flex-col gap-2 border-t border-hairline pt-4 first:border-0 first:pt-0">
        <p className="text-[0.92rem] font-medium flex gap-2 items-baseline">
          <span className="font-mono text-[0.72rem] text-accent">{q.id}</span> {q.ask}
        </p>
        <p className="text-[0.88rem] bg-field rounded-[8px] px-3 py-2.5">
          {!kept && prefill && <span className="block label-mono text-ink-faint mb-1">From {prefill.from}</span>}
          {asText(shown)}
          {!kept && prefill?.evidence && <span className="block text-[0.75rem] text-ink-faint mt-1.5">Why: {prefill.evidence}</span>}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {!kept && prefill && (
            <button type="button" disabled={pending} onClick={() => run(q.id, () => answerAction(tenantId, q.id, prefill.value))} className={btnClass("secondary", "sm")}>
              Yes, keep this
            </button>
          )}
          <button type="button" onClick={() => setEditing(true)} className={btnClass("ghost", "sm")}>Change</button>
          {kept && <span className="text-[0.85rem] text-ok flex items-center gap-1.5"><Check size={14} aria-hidden="true" /> Saved</span>}
        </div>
      </div>
    );
  }

  const submit = () => {
    if (q.format === "chips" || q.format === "multi") return run(q.id, () => answerAction(tenantId, q.id, chips));
    if (q.format === "shorts") return run(q.id, () => answerAction(tenantId, q.id, shortKeys.length ? shorts : (shorts._ ?? "")));
    // One follow-up for a generic answer, once (file 05, Part 1, rule 4).
    if (q.format === "open" && isGeneric(value) && !followed) { setFollowed(true); return; }
    run(q.id, () => answerAction(tenantId, q.id, value));
  };

  return (
    <div className="flex flex-col gap-2 border-t border-hairline pt-4 first:border-0 first:pt-0">
      <label id={`q-${q.id}-label`} htmlFor={`q-${q.id}`} className="text-[0.92rem] font-medium flex gap-2 items-baseline">
        <span className="font-mono text-[0.72rem] text-accent">{q.id}</span> {q.ask}
      </label>
      {q.example && <p className="text-[0.8rem] text-ink-faint italic">e.g. {q.example}</p>}
      <RestoredNote on={restored && !done.includes(q.id)} />
      {q.format === "mcq" && q.options && (
        <div className="flex flex-col gap-1.5" role="radiogroup" aria-labelledby={`q-${q.id}-label`}>
          {q.options.map((o) => <Choice key={o} radio on={value === o} onToggle={() => setValue(o)}>{o}</Choice>)}
        </div>
      )}
      {q.format === "multi" && q.options && (
        <div className="flex flex-col gap-1.5" role="group" aria-labelledby={`q-${q.id}-label`}>
          {q.options.map((o) => <Choice key={o} on={chips.includes(o)} onToggle={() => setChips(chips.includes(o) ? chips.filter((c) => c !== o) : [...chips, o])}>{o}</Choice>)}
        </div>
      )}
      {q.format === "shorts" && (
        <div className="flex flex-col gap-2">
          {(shortKeys.length ? shortKeys : ["_"]).map((k) => (
            <label key={k} className="block">
              {k !== "_" && <span className="block text-[0.8rem] text-ink-muted mb-1">{k}</span>}
              <input value={shorts[k] ?? ""} onChange={(e) => setShorts({ ...shorts, [k]: e.target.value })} className="field" />
            </label>
          ))}
        </div>
      )}
      {q.format === "chips" && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {[...new Set([...(q.options ?? []), ...chips])].map((o) => (
              <button key={o} type="button" aria-pressed={chips.includes(o)} onClick={() => setChips(chips.includes(o) ? chips.filter((c) => c !== o) : [...chips, o])}
                className={`min-h-11 px-3.5 rounded-full border text-[0.82rem] ${chips.includes(o) ? "bg-ink text-on-ink border-ink" : "border-line hover:border-ink"}`}>{o}</button>
            ))}
          </div>
          <input id={`q-${q.id}`} placeholder="Add your own and press Enter" className="field max-w-sm"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const v = e.currentTarget.value.trim(); if (v) setChips([...chips, v]); e.currentTarget.value = ""; } }} />
        </>
      )}
      {(q.format === "open" || q.format === "short") && (
        <textarea id={`q-${q.id}`} rows={q.format === "short" ? 2 : 3} value={value} onChange={(e) => setValue(e.target.value)} className="field" />
      )}
      {q.spoken && (q.format === "open" || q.format === "short") && (
        <VoiceRecorder tenantId={tenantId} enabled={canRecord} onText={(t) => setValue((v) => (v.trim() ? `${v.trim()}\n\n${t}` : t))} />
      )}
      {followed && !done.includes(q.id) && (
        <p className="text-[0.82rem] text-warn flex items-start gap-1.5"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> {q.followUp ?? DEFAULT_FOLLOW_UP} Save again to keep it as it is.</p>
      )}
      <div className="flex items-center gap-3">
        <button type="button" disabled={pending || empty} onClick={submit} className={btnClass("secondary", "sm")}>Save</button>
        {saved && <span className="text-[0.85rem] text-ok flex items-center gap-1.5"><Check size={14} aria-hidden="true" /> Saved</span>}
        {q.spoken && <span className="text-[0.75rem] text-ink-faint">A long answer is also kept as a spoken sample.</span>}
      </div>
    </div>
  );
}

function Benchmarks({ tenantId, candidates, initial }: { tenantId: string; candidates: { id: string; text: string; channel: string }[]; initial: string[] }) {
  const { pending, done, run } = useSaver();
  const [picks, setPicks] = useStepDraft<string[]>("benchmarks", initial.slice(0, 3));
  return (
    <Section title="Pick the three that are most you" sub="Not the most liked. The most you. These are the pieces drafts learn your rhythm from first.">
      <div className="flex flex-col gap-2">
        {candidates.map((c) => (
          <Choice key={c.id} on={picks.includes(c.id)} onToggle={() => setPicks(picks.includes(c.id) ? picks.filter((p) => p !== c.id) : picks.length < 3 ? [...picks, c.id] : picks)}>
            <span className="block whitespace-pre-wrap line-clamp-4">{c.text}</span>
            <span className="label-mono text-ink-faint">{PLATFORM_RULES[c.channel]?.label ?? c.channel}</span>
          </Choice>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" disabled={pending || picks.length !== 3} onClick={() => run("G2", () => benchmarksAction(tenantId, picks))} className={btnClass("secondary", "sm")}>Save my three</button>
        <span className="text-[0.8rem] text-ink-faint tabular-nums">{picks.length} of 3</span>
        {done.includes("G2") && <span className="text-[0.85rem] text-ok flex items-center gap-1.5"><Check size={14} aria-hidden="true" /> Saved</span>}
      </div>
    </Section>
  );
}

// =============================================================================
// Step 4 — First draft (the payoff)
// =============================================================================

export function PayoffStep(props: {
  tenantId: string;
  mode: WorkMode;
  core: ReactNode;
  mirror: {
    words: string[];
    openers: string[];
    never: string[];
    guardrail: { id: string; name: string; rule: string } | null;
    dials: Partial<Record<DialKey, number>>;
    estimated: Partial<Record<DialKey, number>>;
  };
  missing: string[];
  confidence: number;
  first: { id: string; name: string; hook: string | null; body: string | null; cta: string | null; score: number | null; band: string | null } | null;
  /** The first piece is still being written (a reload mid-write), or that write died. */
  firstState: "writing" | "failed" | null;
  ownCheck: { excerpt: string; score: number; band: string; issues: string[] } | null;
}) {
  const { tenantId } = props;
  const router = useRouter();
  const prefix = useDraftPrefix();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<WorkMode>(props.mode);
  const [own, setOwn] = useStepDraft("ownFirst", "");
  const [writeError, setWriteError] = useState(false);
  const writing = props.firstState === "writing" && !props.first?.hook;

  // Written by a request this page didn't start (it was reloaded mid-write):
  // re-read until it lands or goes stale.
  useEffect(() => {
    if (!writing) return;
    const t = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(t);
  }, [writing, router]);

  const writeFirst = () => start(async () => {
    setWriteError(false);
    try {
      await firstPieceAction(tenantId);
    } catch {
      setWriteError(true);
    }
    router.refresh();
  });
  const band = (b: string | null) => (b === "on_brand" ? "on" : b === "drifting" ? "drift" : "off") as "on" | "drift" | "off";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[1.9rem]">Here's how you <span className="serif-accent">sound.</span></h1>
        <p className="text-ink-muted mt-2 max-w-[62ch]">Your voice mirror, a first piece written in it, and a check on something you've already written. Edit anything that's wrong; every change trains the core.</p>
      </div>

      {props.confidence < 70 && (
        <div role="alert" className="flex items-start gap-3 bg-warn-soft text-warn rounded-[10px] px-4 py-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="text-[0.88rem]">
            <p className="font-medium">Your core is {props.confidence}% confident, so it's still learning.</p>
            <p className="mt-0.5">{props.missing[0] ?? "Add more of your writing"} and drafts will hold your voice more closely. <Link href={`/w/${tenantId}/onboarding?step=1`} className="underline underline-offset-2">Add writing</Link></p>
          </div>
        </div>
      )}

      <div className="min-w-0">{props.core}</div>
      <VoiceMirror tenantId={tenantId} mirror={props.mirror} />

      <Section title="How should we work together?">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Way of working">
          {WORK_MODES.map((m) => (
            <Choice key={m.key} radio on={mode === m.key} onToggle={() => { setMode(m.key); start(async () => { await workModeAction(tenantId, m.key); router.refresh(); }); }}>
              <span className="font-medium block">{m.label}</span>
              <span className="text-[0.8rem] text-ink-muted">{m.sub}</span>
            </Choice>
          ))}
        </div>
      </Section>

      <Section title="Your first piece" sub="On a topic from your own pillars, for the first place you said you write. It becomes your first project.">
        {writing ? (
          <p role="status" className="text-[0.9rem] flex items-center gap-2"><AgentDots /> Writing it in your voice. This page will show it when it&apos;s ready.</p>
        ) : !props.first || ((props.firstState === "failed" || writeError) && !props.first.hook && props.mode !== "check") ? (
          <div className="flex flex-col gap-2 items-start">
            {(props.firstState === "failed" || writeError) && (
              <p role="alert" className="text-[0.85rem] text-warn flex items-center gap-1.5"><AlertTriangle size={14} aria-hidden="true" /> That didn&apos;t finish. Nothing was lost; try again.</p>
            )}
            <button type="button" disabled={pending} aria-busy={pending} onClick={writeFirst} className={btnClass("primary")}>
              {pending ? <><AgentDots /> Writing it in your voice</> : props.first ? "Try again" : mode === "check" ? "Set up my first piece" : "Write my first piece"}
            </button>
          </div>
        ) : props.first.hook ? (
          <div className="flex flex-col gap-3">
            <div className="border border-hairline rounded-[10px] p-4 text-[0.92rem] leading-relaxed whitespace-pre-wrap">
              <p className="font-medium">{props.first.hook}</p>
              {props.first.body && <p className="mt-3">{props.first.body}</p>}
              {props.first.cta && <p className="mt-3 text-ink-muted">{props.first.cta}</p>}
            </div>
            {props.first.score != null && <ScoreMeter score={props.first.score} band={band(props.first.band)} />}
            <p className="text-[0.82rem] text-ink-muted">Not quite you? <Link href={`/w/${tenantId}/p/${props.first.id}/content`} className="text-accent underline underline-offset-2">Edit it</Link>. Edits you repeat become rules you approve.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <label htmlFor="own-first" className="text-[0.88rem]">You chose to write it yourself. Write or paste it here and we'll check it against your voice.</label>
            <textarea id="own-first" rows={6} value={own} onChange={(e) => setOwn(e.target.value)} className="field" />
            <button type="button" disabled={pending || !own.trim()} onClick={() => start(async () => { await ownDraftForFirstPieceAction(tenantId, own); setOwn(""); router.refresh(); })} className={`${btnClass("primary", "sm")} self-start`}>Check it</button>
          </div>
        )}
      </Section>

      {props.ownCheck && (
        <Section title="A check on something you already wrote" sub={<span className="italic">“{props.ownCheck.excerpt}”</span>}>
          <ScoreMeter score={props.ownCheck.score} band={band(props.ownCheck.band)} />
          {props.ownCheck.issues.length ? (
            <ul className="flex flex-col gap-1.5 text-[0.88rem]">{props.ownCheck.issues.map((i) => <li key={i} className="flex gap-2"><Circle size={8} className="mt-2 shrink-0 fill-current" aria-hidden="true" /> {i}</li>)}</ul>
          ) : (
            <p className="text-[0.88rem] text-ink-muted">Nothing to flag. That's what your voice looks like to the check.</p>
          )}
        </Section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <BackStep tenantId={tenantId} to={3} label="Your hue" />
        <form
          action={async (fd) => { const { finishOnboardingAction } = await import("./actions"); await finishOnboardingAction(fd); }}
          onSubmit={() => { if (prefix) clearOnboardingDrafts(prefix); }}
        >
          <input type="hidden" name="tenantId" value={tenantId} />
          <button type="submit" disabled={!props.first || writing} className={btnClass("primary", "lg")}>Yes, that&apos;s me. Open my studio</button>
        </form>
        {(!props.first || writing) && <span className="text-[0.82rem] text-ink-faint">{writing ? "One moment: your first piece is still being written." : "Make your first piece above to finish."}</span>}
      </div>
    </div>
  );
}

// =============================================================================
// The Voice Mirror (step 4): everything the core concluded, edited where it
// stands. Each part saves on its own, through the same writes as the Voice page.
// =============================================================================

function MirrorRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-hairline pt-4 first:border-0 first:pt-0">
      <p className="label-mono text-ink-faint">{label}</p>
      {children}
    </div>
  );
}

function ChipEditor({ name, items, max, tone, onSave, placeholder }: {
  /** Draft name: unsaved chips come back after a reload. */
  name: string;
  items: string[]; max?: number; tone: "accent" | "danger"; onSave: (next: string[]) => Promise<unknown>; placeholder: string;
}) {
  const { pending, done, run } = useSaver();
  const [list, setList] = useStepDraft(name, items);
  const [draft, setDraft] = useState("");
  const dirty = list.join("|") !== items.join("|");
  const add = () => {
    const v = draft.trim();
    if (v && !list.includes(v) && (!max || list.length < max)) setList([...list, v]);
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {list.map((w) => (
          <span key={w} className={`inline-flex items-center gap-1 pl-3 pr-1 min-h-9 rounded-full text-[0.82rem] ${tone === "danger" ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent-ink"}`}>
            {w}
            <button type="button" onClick={() => setList(list.filter((x) => x !== w))} className="hu-hit w-6 h-6 rounded-full flex items-center justify-center hover:bg-paper/60" aria-label={`Remove ${w}`}>
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}
        {(!max || list.length < max) && (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            onBlur={add}
            placeholder={placeholder}
            aria-label={placeholder}
            className="field !w-44 min-h-9"
          />
        )}
      </div>
      {(dirty || done.length > 0) && (
        <div className="flex items-center gap-3">
          {dirty && <button type="button" disabled={pending} onClick={() => run("save", () => onSave(list))} className={btnClass("secondary", "sm")}>Save</button>}
          {!dirty && done.length > 0 && <span className="text-[0.82rem] text-ok flex items-center gap-1.5"><Check size={13} aria-hidden="true" /> Saved</span>}
        </div>
      )}
    </div>
  );
}

function VoiceMirror({ tenantId, mirror }: { tenantId: string; mirror: Parameters<typeof PayoffStep>[0]["mirror"] }) {
  const saver = useSaver();
  const [rule, setRule] = useStepDraft("mirror:rule", mirror.guardrail?.rule ?? "");
  const [dials, setDials] = useStepDraft<Partial<Record<DialKey, number>>>(
    "mirror:dials",
    Object.fromEntries(DIAL_KEYS.map((k) => [k, mirror.dials[k] ?? mirror.estimated[k] ?? 5])) as Partial<Record<DialKey, number>>,
  );
  const dialsDirty = DIAL_KEYS.some((k) => dials[k] !== (mirror.dials[k] ?? mirror.estimated[k] ?? 5));

  return (
    <Section title="Your voice mirror" sub="What your core concluded about how you sound. Change anything that's wrong, right here.">
      <MirrorRow label="Your four words">
        <ChipEditor name="mirror:words" items={mirror.words} max={4} tone="accent" placeholder="Add a word" onSave={(w) => answerAction(tenantId, "C6", w)} />
      </MirrorRow>

      <MirrorRow label="How you open">
        {mirror.openers.length ? (
          <ul className="flex flex-col gap-1.5">
            {mirror.openers.map((o) => (
              <li key={o} className="flex items-start gap-2 text-[0.88rem]">
                <span className="flex-1 italic">“{o}”</span>
                <button type="button" disabled={saver.pending} onClick={() => saver.run(`o:${o}`, () => dropOpenerAction(tenantId, o))} className={btnClass("ghost", "sm")}>
                  Tired of it
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[0.85rem] text-ink-faint">Add writing to see how you open.</p>
        )}
      </MirrorRow>

      <MirrorRow label="The dials">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          {DIAL_KEYS.map((k) => {
            const [l, r] = DIAL_LABELS[k];
            return (
              <label key={k} className="block">
                <span className="flex justify-between text-[0.75rem] text-ink-muted"><span>{l}</span><span className="font-mono text-ink">{dials[k]}</span><span>{r}</span></span>
                <input type="range" min={1} max={10} value={dials[k]} onChange={(e) => setDials({ ...dials, [k]: Number(e.target.value) })} className="w-full accent-[var(--ink)] min-h-11" aria-label={`${l} to ${r}`} />
              </label>
            );
          })}
        </div>
        {dialsDirty && (
          <button type="button" disabled={saver.pending} onClick={() => saver.run("dials", () => dialsAction(tenantId, dials))} className={`${btnClass("secondary", "sm")} self-start`}>Save dials</button>
        )}
      </MirrorRow>

      <MirrorRow label="Never">
        <ChipEditor name="mirror:never" items={mirror.never} tone="danger" placeholder="Add a word or phrase" onSave={(w) => neverWordsAction(tenantId, w)} />
      </MirrorRow>

      <MirrorRow label={mirror.guardrail ? mirror.guardrail.name : "A line you don't cross"}>
        <textarea rows={2} value={rule} onChange={(e) => setRule(e.target.value)} placeholder="I never name a client without asking first." className="field" aria-label="A line you don't cross" />
        {rule.trim() !== (mirror.guardrail?.rule ?? "") && (
          <button
            type="button"
            disabled={saver.pending}
            onClick={() => saver.run("line", () => (mirror.guardrail ? guardrailAction(tenantId, mirror.guardrail.id, rule) : answerAction(tenantId, "D7", rule)))}
            className={`${btnClass("secondary", "sm")} self-start`}
          >
            Save
          </button>
        )}
      </MirrorRow>

      {saver.done.length > 0 && <p className="text-[0.82rem] text-ok flex items-center gap-1.5"><Check size={13} aria-hidden="true" /> Saved. Your core now reads it.</p>}
    </Section>
  );
}
