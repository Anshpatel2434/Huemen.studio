"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Sparkles } from "lucide-react";
import { AgentDots, Choice, Field, Modal, Segmented, useToast } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { CALENDAR_CHANNELS, CALENDAR_DAYS, planSlots, todayIso } from "@/lib/content/calendar-plan";
import { addCalendarEntryAction, generateCalendarAction, moveCalendarEntryAction } from "../actions";
import { Select } from "@/components/select";

type Pillar = { id: string; name: string };

// ---- the app's own day picker (never the browser's date popup) ---------------

const two = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${two(m + 1)}-${two(d)}`;
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const longDay = (iso: string) =>
  new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

/**
 * One month of days as buttons, Monday first, with arrows to change month.
 * Days before `min` can't be picked. Keyboard: Tab to a day, Enter to pick.
 */
export function DayPicker({ value, onChange, min }: { value: string; onChange: (iso: string) => void; min?: string }) {
  const [view, setView] = useState(() => ({ y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) - 1 }));
  const first = new Date(view.y, view.m, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => (i - lead + 1 >= 1 && i - lead + 1 <= days ? i - lead + 1 : null));
  const step = (by: number) => setView((v) => { const d = new Date(v.y, v.m + by, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  // No going back past the month that holds the earliest day allowed.
  const atMin = !!min && isoOf(view.y, view.m, 1) <= `${min.slice(0, 8)}01`;

  return (
    <div role="group" aria-label="Pick a day">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={() => step(-1)} disabled={atMin} className="hu-iconbtn border border-line disabled:opacity-40" aria-label="Previous month"><ChevronLeft size={15} aria-hidden="true" /></button>
        <p className="text-sm font-medium" aria-live="polite">{first.toLocaleString("en-GB", { month: "long", year: "numeric" })}</p>
        <button type="button" onClick={() => step(1)} className="hu-iconbtn border border-line" aria-label="Next month"><ChevronRight size={15} aria-hidden="true" /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEK.map((d) => <span key={d} className="label-mono text-ink-faint py-1">{d}</span>)}
        {cells.map((d, i) => {
          if (d === null) return <span key={i} aria-hidden="true" />;
          const iso = isoOf(view.y, view.m, d);
          const off = !!min && iso < min;
          const on = iso === value;
          return (
            <button
              key={i}
              type="button"
              disabled={off}
              aria-pressed={on}
              aria-label={longDay(iso)}
              onClick={() => onChange(iso)}
              className={`min-h-10 rounded-sm text-sm tabular-nums transition-colors ${on ? "bg-ink text-on-ink" : off ? "text-ink-faint opacity-40 cursor-not-allowed" : "hover:bg-hover"}`}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** "Move" on a slot: pick another day in the app's own calendar. The slot keeps everything else. */
export function MoveSlotButton({ tenantId, id, date, topic }: { tenantId: string; id: string; date: string; topic: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const today = todayIso();
  const [to, setTo] = useState(date);
  const [pending, start] = useTransition();

  const move = () =>
    start(async () => {
      try {
        const r = await moveCalendarEntryAction(tenantId, id, to);
        if (!r.ok) return toast("That slot couldn't be moved. It may have been removed.", "danger");
        setOpen(false);
        toast(`Moved to ${longDay(to)}`);
        router.refresh();
      } catch {
        toast("That slot couldn't be moved. Try again.", "danger");
      }
    });

  return (
    <>
      <button type="button" onClick={() => { setTo(date); setOpen(true); }} className="hu-hit inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink hover:underline underline-offset-2">
        <CalendarDays size={10} aria-hidden="true" /> Move
      </button>
      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title="Move this slot"
        width={400}
        footer={
          <>
            <button type="button" onClick={() => setOpen(false)} disabled={pending} className={btnClass("secondary")}>Cancel</button>
            <button type="button" onClick={move} disabled={pending || to === date || to < today} className={btnClass("primary")}>
              {pending ? <AgentDots /> : to === date ? "Pick another day" : `Move to ${longDay(to).replace(/^\w+ /, "")}`}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted leading-relaxed">“{topic}” is on {longDay(date)}. Pick the day it should move to; its topic, channel and pillar stay as they are.</p>
          {/* Keyed by the open slot's date so it opens on that month every time. */}
          <DayPicker key={`${date}:${open}`} value={to} onChange={setTo} min={today} />
        </div>
      </Modal>
    </>
  );
}

const CADENCE = [
  { value: "2", label: "2 a week" },
  { value: "3", label: "3 a week" },
  { value: "5", label: "Weekdays" },
] as const;

/**
 * "Generate 90 days": the cadence and channels are chosen here, the days are
 * planned in code and one model call fills them. The modal says how many
 * slots that makes before anything runs, so the number is never a surprise.
 */
export function GenerateCalendarButton({ tenantId, pillarCount, busy = false }: { tenantId: string; pillarCount: number; busy?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [perWeek, setPerWeek] = useState<"2" | "3" | "5">("3");
  const [channels, setChannels] = useState<string[]>(["linkedin", "newsletter"]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const start_ = todayIso();
  const count = planSlots({ start: start_, perWeek: Number(perWeek), channels }).length;

  const toggle = (key: string) =>
    setChannels((c) => (c.includes(key) ? c.filter((x) => x !== key) : [...c, key]));

  const run = () =>
    start(async () => {
      setError("");
      try {
        // Queued (lib/jobs): the page shows it running and what it planned.
        await generateCalendarAction(tenantId, { start: start_, perWeek: Number(perWeek), channels });
        setOpen(false);
        router.refresh();
      } catch {
        // The choices stay in the form (brief §07: never lose a user's input).
        setError("Planning couldn't start. Your choices are still here, so try again.");
      }
    });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btnClass("secondary", "sm")} disabled={pillarCount === 0 || busy} title={pillarCount === 0 ? "Add pillars in Brand core first; the plan is written from them." : undefined}>
        <Sparkles size={14} aria-hidden="true" /> {busy ? "Planning…" : `Generate ${CALENDAR_DAYS} days`}
      </button>
      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={`Plan the next ${CALENDAR_DAYS} days`}
        width={520}
        footer={
          <>
            <button type="button" onClick={() => setOpen(false)} disabled={pending} className={btnClass("secondary")}>Cancel</button>
            <button type="button" onClick={run} disabled={pending || channels.length === 0} className={btnClass("primary")}>
              {pending ? <><AgentDots /> Starting…</> : `Plan ${count} slots`}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <p className="text-sm text-ink-muted leading-relaxed">
            One slot per publishing day, from today, rotating your {pillarCount} pillar{pillarCount === 1 ? "" : "s"}: a topic, how it opens and the ask. Days that already have a slot are left alone. Every slot is a draft you can edit, move or delete.
          </p>
          <div>
            <p className="hu-label mb-2">How often</p>
            <Segmented label="Posting cadence" value={perWeek} onChange={setPerWeek} items={CADENCE.map((c) => ({ value: c.value, label: c.label }))} />
          </div>
          <div>
            <p className="hu-label mb-2">Where</p>
            <div className="flex flex-col gap-1">
              {CALENDAR_CHANNELS.map((c) => (
                <Choice key={c.key} label={c.label} checked={channels.includes(c.key)} onChange={() => toggle(c.key)} />
              ))}
            </div>
            {channels.length === 0 && <p className="hu-hint hu-hint--error mt-1">Pick at least one channel.</p>}
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      </Modal>
    </>
  );
}

/** The + on a day cell: add a slot to THAT day, so there is no date to type. */
export function AddSlotButton({ tenantId, date, label, pillars }: { tenantId: string; date: string; label: string; pillars: Pillar[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [pillarId, setPillarId] = useState("");
  const [channel, setChannel] = useState<string>("linkedin");
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("tenantId", tenantId);
      fd.set("date", date);
      fd.set("topic", topic);
      fd.set("pillarId", pillarId);
      fd.set("channel", channel);
      try {
        await addCalendarEntryAction(fd);
        setOpen(false);
        setTopic("");
        toast("Slot added");
        router.refresh();
      } catch {
        toast("Couldn't add that slot.", "danger");
      }
    });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Add a slot on ${label}`}
        className="hu-hit absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center text-ink-faint opacity-0 group-hover/day:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 hover:text-ink hover:bg-hover"
      >
        <Plus size={14} aria-hidden="true" />
      </button>
      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={`Add a slot · ${label}`}
        width={440}
        footer={
          <>
            <button type="button" onClick={() => setOpen(false)} disabled={pending} className={btnClass("secondary")}>Cancel</button>
            <button type="button" onClick={submit} disabled={pending || !topic.trim()} className={btnClass("primary")}>{pending ? <AgentDots /> : "Add slot"}</button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Topic" required>
            <input value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && topic.trim()) submit(); }} className="field" placeholder="What this piece is about" autoFocus />
          </Field>
          <div>
            <p className="hu-label mb-2">Channel</p>
            <div className="flex flex-wrap gap-1.5">
              {CALENDAR_CHANNELS.map((c) => (
                <button key={c.key} type="button" onClick={() => setChannel(c.key)} aria-pressed={channel === c.key} className={`min-h-11 px-4 rounded-full text-sm border transition-colors ${channel === c.key ? "bg-ink text-on-ink border-ink" : "border-line hover:border-line-strong hover:bg-hover"}`}>{c.label}</button>
              ))}
            </div>
          </div>
          {pillars.length > 0 && (
            <Field label="Pillar">
              <Select value={pillarId} onChange={setPillarId} label="Pillar" options={[{ value: "", label: "No pillar" }, ...pillars.map((p) => ({ value: p.id, label: p.name }))]} />
            </Field>
          )}
        </div>
      </Modal>
    </>
  );
}
