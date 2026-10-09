"use client";

/**
 * The parts of onboarding that ask less and learn more:
 *
 *   VoicePreview   one paragraph in their voice, beside every step, rewritten
 *                  each time the pack changes
 *   ThisOrThat     the dials as a game: two near-identical lines, pick yours
 *   Suggestions    starts the pre-fill pass when there's something new to read
 *   UrlImport      their own writing from links: site, blog, Substack, Medium,
 *                  a podcast feed with transcripts
 *   Stories, Proofs, Influences, Languages
 *                  what a draft needs and can't invent
 *   BrandImages    logo and headshot
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { ArrowRight, Check, ImagePlus, Link2, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { btnClass } from "@/components/btn";
import { AgentDots } from "@/components/ui";
import { DIAL_LABELS, LANGUAGES, type DialKey, type LanguageKey, type LanguageMix, type Proof, type Story } from "@/lib/voice/types";
import { uploadAssetAction } from "@/app/w/[id]/brand/actions";
import {
  finishIngestAction, importUrlAction, influencesAction, languagesAction, pairsAction, picksAction, previewAction,
  proofsAction, storiesAction, suggestionsAction,
} from "./actions";
import { useStepDraft } from "./draft";

const Box = ({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) => (
  <section className="bg-paper border border-hairline rounded-md p-5 flex flex-col gap-4">
    <div>
      <h2 className="text-base">{title}</h2>
      {sub && <p className="text-sm text-ink-muted mt-1">{sub}</p>}
    </div>
    {children}
  </section>
);

const Saved = ({ on }: { on: boolean }) =>
  on ? <span className="text-sm text-ok flex items-center gap-1.5"><Check size={14} aria-hidden="true" /> Saved</span> : null;

// ---- the live preview ------------------------------------------------------------------

/**
 * Re-asks for the preview whenever `version` changes (every save bumps it),
 * so each answer visibly moves the paragraph. The server caches per version:
 * a reload costs nothing.
 */
export function VoicePreview({ tenantId, version }: { tenantId: string; version: number }) {
  const [text, setText] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [prev, setPrev] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const last = useRef<string | null>(null);

  useEffect(() => {
    start(async () => {
      const r = await previewAction(tenantId);
      if (!r.ok) return setError(r.error);
      setError(null);
      if (last.current && last.current !== r.value.text) setPrev(last.current);
      last.current = r.value.text;
      setText(r.value.text);
      setSource(r.value.source);
    });
  }, [tenantId, version]);

  return (
    <aside aria-live="polite" className="bg-paper border border-hairline rounded-md p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Sparkles size={14} className="text-accent" aria-hidden="true" />
        <p className="label-mono text-ink-faint flex-1">Your voice so far</p>
        {pending && <AgentDots />}
      </div>
      {error ? (
        <p className="text-sm text-ink-muted">{error}</p>
      ) : text ? (
        <p className="text-base leading-relaxed">{text}</p>
      ) : (
        <p className="text-sm text-ink-faint">Writing a paragraph the way you would…</p>
      )}
      {prev && text && prev !== text && (
        <details className="text-xs">
          <summary className="cursor-pointer text-ink-faint min-h-9 flex items-center">Before your last answer</summary>
          <p className="text-ink-muted leading-relaxed">{prev}</p>
        </details>
      )}
      {source && (
        <details className="text-xs">
          <summary className="cursor-pointer text-ink-faint min-h-9 flex items-center">The plain version it started from</summary>
          <p className="text-ink-muted leading-relaxed">{source}</p>
        </details>
      )}
      <p className="text-xs text-ink-faint">It changes as you answer. Nothing here is saved as your writing.</p>
    </aside>
  );
}

// ---- pre-fill -----------------------------------------------------------------------------

/** Starts the pre-fill pass when there's something new to read, then refreshes the answers. */
export function Suggestions({ tenantId, needed, at }: { tenantId: string; needed: boolean; at: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  const run = (force: boolean) => start(async () => {
    const r = await suggestionsAction(tenantId, force);
    if (!r.ok) setError(r.error);
    else setError(null);
    router.refresh();
  });

  useEffect(() => {
    if (needed && !ran.current) {
      ran.current = true;
      run(false);
    }
  });

  return (
    <div role="status" className="flex flex-wrap items-center gap-3 bg-accent-soft rounded-md px-4 py-3 text-sm">
      <Sparkles size={15} className="text-accent shrink-0" aria-hidden="true" />
      <span className="flex-1 min-w-0">
        {pending
          ? "Reading your writing and your brief to fill in what we can…"
          : error
            ? error
            : at
              ? "We've filled in what your writing and brief already answer. Keep what's right, change what isn't."
              : "Add some writing and we'll fill in what it already answers."}
      </span>
      {!pending && at && (
        <button type="button" onClick={() => run(true)} className={btnClass("ghost", "sm")}>
          <RefreshCw size={13} aria-hidden="true" /> Read again
        </button>
      )}
    </div>
  );
}

// ---- this or that ---------------------------------------------------------------------------

type Pair = { dial: DialKey; left: string; right: string };
type Side = "left" | "right" | "neither";

/** Which line goes on top: fixed per dial, so a side never stands for an answer. */
const flipped = (dial: DialKey) => dial.length % 2 === 1;

export function ThisOrThat({ tenantId, done, children }: { tenantId: string; done: boolean; children: ReactNode }) {
  const router = useRouter();
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [i, setI] = useState(0);
  // Picks so far survive a reload: the pairs are cached on the server per basis,
  // so "Carry on" fetches the same pairs and resumes at the next one.
  const [picks, setPicks] = useStepDraft<{ dial: DialKey; side: Side }[]>("thisOrThat", []);
  const [error, setError] = useState<string | null>(null);
  /** How many picks set the dials, once they're saved. */
  const [finished, setFinished] = useState<number | null>(null);
  const [sliders, setSliders] = useState(false);
  const [pending, start] = useTransition();

  const begin = (resume: boolean) => start(async () => {
    const r = await pairsAction(tenantId);
    if (!r.ok) return setError(r.error);
    // Resume only if the saved picks are the start of these same pairs.
    const fits = resume && picks.length < r.value.length && picks.every((p, j) => r.value[j]?.dial === p.dial);
    setPairs(r.value);
    setI(fits ? picks.length : 0);
    if (!fits) setPicks([]);
    setFinished(null);
  });

  const finish = (all: { dial: DialKey; side: Side }[]) => start(async () => {
    await picksAction(tenantId, all);
    setPicks([]);
    setFinished(all.length);
    router.refresh();
  });

  const choose = (side: Side) => {
    if (!pairs) return;
    const next = [...picks, { dial: pairs[i].dial, side }];
    setPicks(next);
    if (i + 1 >= pairs.length) finish(next);
    else setI(i + 1);
  };

  const pair = pairs?.[i];
  const options = pair ? (flipped(pair.dial) ? [["right", pair.right], ["left", pair.left]] : [["left", pair.left], ["right", pair.right]]) as [Side, string][] : [];

  return (
    <Box title="Which sounds more like you?" sub="Two versions of the same line. Pick yours. It sets your dials, and the lines you pick teach every draft.">
      {!pairs && finished == null && (
        <div className="flex flex-wrap items-center gap-3">
          {picks.length > 0 && (
            <button type="button" disabled={pending} onClick={() => begin(true)} className={btnClass("primary", "sm")}>
              {pending ? <><AgentDots /> Loading your pairs</> : `Carry on from pair ${picks.length + 1}`}
            </button>
          )}
          <button type="button" disabled={pending} onClick={() => begin(false)} className={btnClass(done || picks.length > 0 ? "secondary" : "primary", "sm")}>
            {pending && !picks.length ? <><AgentDots /> Writing the pairs</> : picks.length > 0 ? "Start over" : done ? "Play again" : "Start"}
          </button>
          {done && <span className="text-sm text-ok flex items-center gap-1.5"><Check size={14} aria-hidden="true" /> Your dials are set</span>}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {pair && finished == null && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-field overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={pairs!.length} aria-valuenow={i}>
              <div className="h-full bg-ink transition-all duration-300" style={{ width: `${(i / pairs!.length) * 100}%` }} />
            </div>
            <span className="text-xs text-ink-faint tabular-nums">{i + 1} of {pairs!.length}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {options.map(([side, line]) => (
              <button
                key={side}
                type="button"
                disabled={pending}
                onClick={() => choose(side)}
                className="text-left border border-hairline hover:border-ink rounded-md p-4 min-h-24 text-base leading-relaxed transition-colors"
              >
                “{line}”
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={() => choose("neither")} className={btnClass("ghost", "sm")}>Both, or neither</button>
            {i >= 4 && (
              <button type="button" disabled={pending} onClick={() => finish(picks)} className={btnClass("ghost", "sm")}>That&apos;s enough for now</button>
            )}
          </div>
          <p className="sr-only">This pair is about {DIAL_LABELS[pair.dial][0]} or {DIAL_LABELS[pair.dial][1]}.</p>
        </div>
      )}

      {finished != null && (
        <p role="status" className="text-sm text-ok flex items-center gap-2"><Check size={15} aria-hidden="true" /> Dials set from your {finished} picks.</p>
      )}

      <button type="button" onClick={() => setSliders(!sliders)} className={`${btnClass("ghost", "sm")} self-start`}>
        {sliders ? "Hide the sliders" : "Fine-tune with sliders"}
      </button>
      {sliders && children}
    </Box>
  );
}

// ---- links: their own site, blog, Substack, Medium, podcast ----------------------------------

export function UrlImport({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [text, setText] = useStepDraft("links", "");
  const [mine, setMine] = useStepDraft("linksMine", false);
  const [log, setLog] = useState<{ url: string; ok: boolean; text: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const urls = useMemo(() => [...new Set(text.split(/\s+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)))].slice(0, 10), [text]);

  const go = () => start(async () => {
    const out: typeof log = [];
    let total = 0;
    for (const url of urls) {
      setBusy(url);
      const r = await importUrlAction(tenantId, url);
      if (r.ok) {
        total += r.value.added;
        out.push({ url, ok: true, text: `${r.value.note}${r.value.found > r.value.added ? ` ${r.value.found - r.value.added} already on file.` : ""}` });
      } else out.push({ url, ok: false, text: r.error });
      setLog([...out]);
    }
    setBusy("measuring");
    if (total) await finishIngestAction(tenantId);
    setBusy(null);
    // Read links leave the box; the ones that failed stay, to fix and retry.
    setText(out.filter((l) => !l.ok).map((l) => l.url).join("\n"));
    router.refresh();
  });

  return (
    <Box title="From a link" sub="Your website, blog, Substack, Medium, or a podcast feed with transcripts. We read the posts there, up to 30 per link.">
      <label className="block">
        <span className="block text-sm font-medium mb-1"><Link2 size={13} className="inline mr-1" aria-hidden="true" />Links, one per line</span>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={"https://yourname.substack.com\nhttps://medium.com/@yourname\nhttps://yoursite.com/blog"} className="field font-mono text-sm" />
      </label>
      <label className="flex items-start gap-2 min-h-11 text-sm cursor-pointer">
        <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="mt-1" />
        <span>This is my own writing, or a podcast I host. We only learn your voice from your own words.</span>
      </label>
      <button type="button" disabled={pending || !mine || !urls.length} onClick={go} className={`${btnClass("secondary", "sm")} self-start`}>
        {pending ? <><AgentDots /> {busy === "measuring" ? "Building your core" : "Reading"}</> : `Read ${urls.length || ""} ${urls.length === 1 ? "link" : "links"}`}
      </button>
      {log.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {log.map((l) => (
            <li key={l.url} className={l.ok ? "text-ink-muted" : "text-danger"}>
              <span className="font-mono text-ink-faint break-all">{l.url}</span>: {l.text}
            </li>
          ))}
        </ul>
      )}
    </Box>
  );
}

// ---- stories and proof --------------------------------------------------------------------

function RowList<T>({ rows, blank, render, onChange }: { rows: T[]; blank: T; render: (row: T, set: (r: T) => void, i: number) => ReactNode; onChange: (rows: T[]) => void }) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r, i) => (
        <div key={i} className="relative border border-hairline rounded-md p-3 pr-10 flex flex-col gap-2">
          {render(r, (next) => onChange(rows.map((x, j) => (j === i ? next : x))), i)}
          <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="hu-hit absolute top-2 right-2 w-7 h-7 rounded-sm flex items-center justify-center text-ink-faint hover:text-ink hover:bg-field" aria-label="Remove">
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, blank])} className={`${btnClass("ghost", "sm")} self-start`}><Plus size={14} aria-hidden="true" /> Add another</button>
    </div>
  );
}

export function StoriesEditor({ tenantId, initial }: { tenantId: string; initial: Story[] }) {
  const router = useRouter();
  const [rows, setRows] = useStepDraft<Story[]>("stories", initial.length ? initial : [{ title: "", body: "" }]);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  // A story is kept only with both a name and what happened (lib/data/enrich);
  // say so, rather than "Saved" over a story that wasn't.
  const half = rows.filter((s) => !!s.title.trim() !== !!s.body.trim());
  return (
    <Box title="Stories you tell" sub="The 3 to 5 stories you come back to: on stage, in posts, over coffee. Drafts can use them; they can't invent them.">
      <RowList
        rows={rows}
        blank={{ title: "", body: "" }}
        onChange={(r) => { setSaved(false); setRows(r); }}
        render={(s, set, i) => (
          <>
            <input value={s.title} onChange={(e) => set({ ...s, title: e.target.value })} placeholder="A short name: “The client who fired me”" aria-label={`Story ${i + 1} name`} className="field" />
            <textarea rows={3} value={s.body} onChange={(e) => set({ ...s, body: e.target.value })} placeholder="What happened, the way you tell it." aria-label={`Story ${i + 1}`} className="field" />
            <input value={s.lesson ?? ""} onChange={(e) => set({ ...s, lesson: e.target.value })} placeholder="What it shows (optional)" aria-label={`What story ${i + 1} shows`} className="field" />
          </>
        )}
      />
      <div className="flex items-center gap-3">
        <button type="button" disabled={pending} onClick={() => start(async () => { await storiesAction(tenantId, rows); setSaved(true); router.refresh(); })} className={btnClass("secondary", "sm")}>Save stories</button>
        <Saved on={saved && !half.length} />
      </div>
      {half.length > 0 && (
        <p role={saved ? "alert" : undefined} className="text-sm text-warn">
          {half.map((s) => (s.title.trim() ? `“${s.title.trim()}” needs what happened` : "A story needs a short name")).join("; ")}
          {saved ? ". It isn't saved until it has both." : " before it can be saved."}
        </p>
      )}
    </Box>
  );
}

export function ProofsEditor({ tenantId, initial }: { tenantId: string; initial: Proof[] }) {
  const router = useRouter();
  const [rows, setRows] = useStepDraft<Proof[]>("proofs", initial.length ? initial : [{ claim: "" }]);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  // A source with no claim is dropped on save; say so.
  const orphan = rows.filter((p) => !p.claim.trim() && p.source?.trim());
  return (
    <Box title="Facts you can stand behind" sub="Numbers, results, client wins. Drafts never invent a fact, so these are the ones they're allowed to use. Say where each comes from.">
      <RowList
        rows={rows}
        blank={{ claim: "" }}
        onChange={(r) => { setSaved(false); setRows(r); }}
        render={(p, set, i) => (
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2">
            <input value={p.claim} onChange={(e) => set({ ...p, claim: e.target.value })} placeholder="“140 first-time managers coached since 2021”" aria-label={`Fact ${i + 1}`} className="field" />
            <input value={p.source ?? ""} onChange={(e) => set({ ...p, source: e.target.value })} placeholder="Source: my records, 2025" aria-label={`Source for fact ${i + 1}`} className="field" />
          </div>
        )}
      />
      <div className="flex items-center gap-3">
        <button type="button" disabled={pending} onClick={() => start(async () => { await proofsAction(tenantId, rows); setSaved(true); router.refresh(); })} className={btnClass("secondary", "sm")}>Save facts</button>
        <Saved on={saved && !orphan.length} />
      </div>
      {orphan.length > 0 && (
        <p role={saved ? "alert" : undefined} className="text-sm text-warn">
          {orphan.length === 1 ? "A source has" : `${orphan.length} sources have`} no fact beside it{saved ? ", so it isn't saved." : " yet."}
        </p>
      )}
    </Box>
  );
}

// ---- influences and languages -----------------------------------------------------------------

function Chips({ label, items, onChange, placeholder }: { label: string; items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const add = () => { const v = draft.trim(); if (v && !items.includes(v)) onChange([...items, v]); setDraft(""); };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((w) => (
          <span key={w} className="inline-flex items-center gap-1 pl-3 pr-1 min-h-9 rounded-full text-sm bg-field">
            {w}
            <button type="button" onClick={() => onChange(items.filter((x) => x !== w))} className="hu-hit w-6 h-6 rounded-full flex items-center justify-center hover:bg-paper" aria-label={`Remove ${w}`}><X size={12} aria-hidden="true" /></button>
          </span>
        ))}
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} onBlur={add} placeholder={placeholder} aria-label={label} className="field !w-56 min-h-9" />
      </div>
    </div>
  );
}

export function InfluencesEditor({ tenantId, initial }: { tenantId: string; initial: { admire: string[]; avoid: string[] } }) {
  const router = useRouter();
  const [v, setV] = useStepDraft("influences", initial);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Box title="Voices you admire, and ones you'd hate to sound like" sub="Writers, speakers, brands. Drafts borrow qualities, never words.">
      <Chips label="I admire how these write" items={v.admire} onChange={(admire) => { setSaved(false); setV({ ...v, admire }); }} placeholder="A name, then Enter" />
      <Chips label="I never want to sound like" items={v.avoid} onChange={(avoid) => { setSaved(false); setV({ ...v, avoid }); }} placeholder="A name or a type: “LinkedIn hustle bros”" />
      <div className="flex items-center gap-3">
        <button type="button" disabled={pending} onClick={() => start(async () => { await influencesAction(tenantId, v); setSaved(true); router.refresh(); })} className={btnClass("secondary", "sm")}>Save</button>
        <Saved on={saved} />
      </div>
    </Box>
  );
}

export function LanguagesEditor({ tenantId, initial }: { tenantId: string; initial: LanguageMix | null }) {
  const router = useRouter();
  const [primary, setPrimary] = useStepDraft<LanguageKey>("lang:primary", initial?.primary ?? "en");
  const [also, setAlso] = useStepDraft<LanguageKey[]>("lang:also", initial?.also ?? []);
  const [when, setWhen] = useStepDraft("lang:when", initial?.when ?? "");
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Box title="The languages you write in" sub="Drafts follow your mix, script and all.">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium mb-1">Mostly in</legend>
        {LANGUAGES.map((l) => (
          <label key={l.key} className="flex items-center gap-2 min-h-11 text-sm cursor-pointer">
            <input type="radio" name="primary-language" checked={primary === l.key} onChange={() => { setSaved(false); setPrimary(l.key); setAlso(also.filter((a) => a !== l.key)); }} />
            {l.label}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium mb-1">Also mix in</legend>
        {LANGUAGES.filter((l) => l.key !== primary).map((l) => (
          <label key={l.key} className="flex items-center gap-2 min-h-11 text-sm cursor-pointer">
            <input type="checkbox" checked={also.includes(l.key)} onChange={() => { setSaved(false); setAlso(also.includes(l.key) ? also.filter((a) => a !== l.key) : [...also, l.key]); }} />
            {l.label}
          </label>
        ))}
      </fieldset>
      <label className="block">
        <span className="block text-sm font-medium mb-1">When do you switch? (optional)</span>
        <input value={when} onChange={(e) => { setSaved(false); setWhen(e.target.value); }} placeholder="Hinglish on Instagram, English on LinkedIn" className="field" />
      </label>
      <div className="flex items-center gap-3">
        <button type="button" disabled={pending} onClick={() => start(async () => { await languagesAction(tenantId, { primary, also, when }); setSaved(true); router.refresh(); })} className={btnClass("secondary", "sm")}>Save</button>
        <Saved on={saved} />
      </div>
    </Box>
  );
}

// ---- logo and headshot ----------------------------------------------------------------------------

export function BrandImages({ tenantId, logo, headshot }: { tenantId: string; logo: string | null; headshot: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const upload = (kind: "logo" | "headshot", file: File | undefined) => {
    if (!file) return;
    start(async () => {
      setError(null);
      const fd = new FormData();
      fd.append("tenantId", tenantId);
      fd.append("kind", kind);
      fd.append("file", file);
      try {
        await uploadAssetAction(fd);
        router.refresh();
      } catch {
        setError("That file couldn't be used. Use a PNG, JPG or WebP under 5 MB (SVG works for logos).");
      }
    });
  };

  const slot = (kind: "logo" | "headshot", label: string, url: string | null, accept: string) => (
    <label className="flex flex-col items-center gap-2 border border-dashed border-line hover:border-ink rounded-md p-4 cursor-pointer text-center min-h-40 justify-center">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} className={`max-h-24 max-w-full object-contain ${kind === "headshot" ? "rounded-full aspect-square object-cover" : ""}`} />
      ) : (
        <ImagePlus size={22} className="text-ink-faint" aria-hidden="true" />
      )}
      <span className="text-sm font-medium">{url ? `Replace ${label.toLowerCase()}` : `Add your ${label.toLowerCase()}`}</span>
      <input type="file" accept={accept} className="sr-only" onChange={(e) => upload(kind, e.target.files?.[0])} />
    </label>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3">
        {slot("logo", "Logo", logo, "image/png,image/jpeg,image/webp,image/svg+xml")}
        {slot("headshot", "Headshot", headshot, "image/png,image/jpeg,image/webp")}
      </div>
      {pending && <p className="text-sm text-ink-muted flex items-center gap-2"><AgentDots /> Uploading</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <p className="text-xs text-ink-faint flex items-center gap-1">Visuals use them. Your headshot is only used in your own visuals. <ArrowRight size={11} aria-hidden="true" /> Colours can come from your logo below.</p>
    </div>
  );
}
