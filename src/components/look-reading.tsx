"use client";

/**
 * What a person's reference designs say (the look_read reading), and the
 * controls around it: read after a design is added or removed, Try again
 * when it fails, Read again when the designs changed. Shared by onboarding's
 * Look screen and Brand core > Visual, so both show the same reading.
 *
 * The reading runs in its own server action (readLookAction), never inside
 * the upload, so the upload answers at once and the card says "Reading your
 * designs..." meanwhile. Nothing here blocks Continue.
 */
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { btnClass } from "@/components/btn";
import { addReferenceLinkAction, readLookAction } from "@/app/w/[id]/brand/actions";
import { lookIsCurrent, MAX_REFERENCES, type LookReading } from "@/lib/visual/core";

/** The reading, its state, and the two things that change it. */
export function useLookReading(tenantId: string, initial: LookReading | null) {
  const router = useRouter();
  const [look, setLook] = useState<LookReading | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [reading, start] = useTransition();
  // A newer reading from the server (a refresh) wins over the one held here.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    if (initial && (!look || initial.at >= look.at)) setLook(initial);
  }

  const read = useCallback(() => {
    start(async () => {
      setError(null);
      const r = await readLookAction(tenantId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setLook(r.look);
      router.refresh();
    });
  }, [tenantId, router]);

  return { look, reading, error, read };
}

/** "or paste a link": a Pinterest pin or a picture's address, added like an upload. */
export function LinkAdd({ tenantId, disabled, onAdded }: { tenantId: string; disabled?: boolean; onAdded: () => void }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, start] = useTransition();
  const add = () => {
    if (!url.trim()) return;
    start(async () => {
      setError(null);
      const r = await addReferenceLinkAction(tenantId, url);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setUrl("");
      router.refresh();
      onAdded();
    });
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="or paste a Pinterest pin or image link"
          aria-label="Link to a design: a Pinterest pin or an image address"
          disabled={disabled || adding}
          spellCheck={false}
          className="field !min-h-10 text-sm flex-1 min-w-0"
        />
        <button type="button" onClick={add} disabled={disabled || adding || !url.trim()} className={`${btnClass("secondary", "sm")} shrink-0`}>
          {adding ? "Adding" : "Add"}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

/** One design's line and measured colours, with the colours offered as Background or Accent. */
export function DesignNote({ summary, colours, onUse }: {
  summary?: string;
  colours: string[];
  onUse?: (hex: string, role: "background" | "accent") => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  if (!summary && !colours.length) return null;
  return (
    <div className="flex flex-col gap-2 text-left">
      {summary && <p className="text-xs text-ink-muted leading-snug">{summary}</p>}
      {colours.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Colours measured in this design">
          {colours.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setPicked(picked === c ? null : c)}
              disabled={!onUse}
              aria-pressed={picked === c}
              aria-label={`${c}${onUse ? ", use this colour" : ""}`}
              className={`w-6 h-6 rounded-md border transition-shadow ${picked === c ? "border-ink ring-2 ring-ink ring-offset-1 ring-offset-paper" : "border-hairline"} disabled:cursor-default`}
              style={{ background: c }}
            />
          ))}
        </div>
      )}
      {picked && onUse && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs text-ink-muted">{picked}</span>
          <button type="button" onClick={() => { onUse(picked, "background"); setPicked(null); }} className={btnClass("secondary", "sm")}>Background</button>
          <button type="button" onClick={() => { onUse(picked, "accent"); setPicked(null); }} className={btnClass("secondary", "sm")}>Accent</button>
        </div>
      )}
    </div>
  );
}

const Row = ({ label, text }: { label: string; text: string }) =>
  text ? (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 items-baseline">
      <dt className="label-mono text-ink-faint">{label}</dt>
      <dd className="text-sm leading-snug">{text}</dd>
    </div>
  ) : null;

/**
 * "What your designs say": the shared look, then "With your voice". Shows
 * the working state while a reading runs, the failure with Try again, and
 * Read again when the designs on file are not the ones that were read.
 */
export function LookReadingCard({ referenceIds, look, reading, error, onRead, className = "" }: {
  referenceIds: string[];
  look: LookReading | null;
  reading: boolean;
  error: string | null;
  onRead: () => void;
  className?: string;
}) {
  if (!referenceIds.length && !look && !reading && !error) return null;
  const current = lookIsCurrent(look, referenceIds.slice(0, MAX_REFERENCES));
  const shown = look && referenceIds.length ? look : null;
  return (
    <section className={`flex flex-col gap-4 text-left ${className}`} aria-live="polite" aria-busy={reading}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">What your designs say</p>
        {reading ? (
          <span role="status" className="text-sm text-ink-muted inline-flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Reading your designs...</span>
        ) : (
          referenceIds.length > 0 && (
            <button type="button" onClick={onRead} className="inline-flex items-center gap-1.5 min-h-9 px-2 -mr-2 rounded-full text-sm text-ink-muted hover:text-ink hover:bg-hover">
              <RefreshCw size={13} aria-hidden="true" /> {shown ? "Read again" : "Read my designs"}
            </button>
          )
        )}
      </div>

      {error && !reading && (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-danger flex-1 min-w-0">{error}</p>
          <button type="button" onClick={onRead} className={btnClass("secondary", "sm")}>Try again</button>
        </div>
      )}

      {!shown && !reading && !error && referenceIds.length > 0 && (
        <p className="text-sm text-ink-muted">Not read yet. Read them and every picture we make starts from your look.</p>
      )}

      {shown && (
        <>
          {!current && !reading && <p className="text-xs text-ink-faint">Your designs changed since this was read. Read again to update it.</p>}
          <dl className={`flex flex-col gap-2.5 ${reading ? "opacity-60" : ""}`}>
            <Row label="Mood" text={shown.mood} />
            <Row label="Type" text={shown.typeFeel} />
            <Row label="Layout" text={shown.layout} />
            <Row label="Photo style" text={shown.photoStyle} />
            <Row label="Motifs" text={shown.motifs} />
            <Row label="Colour" text={shown.colourUse} />
          </dl>
          {(shown.direction || shown.agrees.length > 0 || shown.clashes.length > 0) && (
            <div className={`flex flex-col gap-2.5 border-t border-hairline pt-4 ${reading ? "opacity-60" : ""}`}>
              <p className="text-sm font-medium">With your voice</p>
              {shown.agrees.length > 0 && <List label="Agrees" items={shown.agrees} />}
              {shown.clashes.length > 0 && <List label="Clashes" items={shown.clashes} />}
              {shown.direction && (
                <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 items-baseline">
                  <span className="label-mono text-ink-faint">Direction</span>
                  <p className="text-sm leading-snug">{shown.direction}</p>
                </div>
              )}
              {shown.avoid.length > 0 && <List label="Avoid" items={shown.avoid} inline />}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function List({ label, items, inline }: { label: string; items: string[]; inline?: boolean }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 items-baseline">
      <span className="label-mono text-ink-faint">{label}</span>
      {/* Short items read as one line; sentences (2026-11-18: the model wrote full ones) get a line each. */}
      {inline && items.every((t) => t.length <= 40) ? (
        <p className="text-sm leading-snug">{items.join(", ")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((t) => <li key={t} className="text-sm leading-snug">{t}</li>)}
        </ul>
      )}
    </div>
  );
}
