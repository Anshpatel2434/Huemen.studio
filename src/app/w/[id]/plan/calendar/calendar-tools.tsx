"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Sparkles } from "lucide-react";
import { AgentDots, Choice, Field, Modal, Segmented, useToast } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { CALENDAR_CHANNELS, CALENDAR_DAYS, planSlots, todayIso } from "@/lib/content/calendar-plan";
import { addCalendarEntryAction, generateCalendarAction } from "../actions";

type Pillar = { id: string; name: string };

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
export function GenerateCalendarButton({ tenantId, pillarCount }: { tenantId: string; pillarCount: number }) {
  const router = useRouter();
  const toast = useToast();
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
        const out = await generateCalendarAction(tenantId, { start: start_, perWeek: Number(perWeek), channels });
        setOpen(false);
        toast(
          out.planned
            ? `${out.planned} slots planned${out.skipped ? `, ${out.skipped} days already had one` : ""}`
            : "Every planned day already has a slot. Nothing added.",
          out.planned ? "success" : "neutral",
        );
        router.push("?");
        router.refresh();
      } catch {
        // The choices stay in the form (brief §07: never lose a user's input).
        setError("Planning failed and was logged. Your choices are still here, so try again.");
      }
    });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btnClass("secondary", "sm")} disabled={pillarCount === 0} title={pillarCount === 0 ? "Add pillars in Brand core first; the plan is written from them." : undefined}>
        <Sparkles size={14} aria-hidden="true" /> Generate {CALENDAR_DAYS} days
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
              {pending ? <><AgentDots /> Planning…</> : `Plan ${count} slots`}
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
        title="Add a slot"
        className="hu-hit absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center text-ink-faint opacity-0 group-hover/day:opacity-100 focus-visible:opacity-100 hover:text-ink hover:bg-hover"
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
              <select value={pillarId} onChange={(e) => setPillarId(e.target.value)} className="field">
                <option value="">No pillar</option>
                {pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}
        </div>
      </Modal>
    </>
  );
}
