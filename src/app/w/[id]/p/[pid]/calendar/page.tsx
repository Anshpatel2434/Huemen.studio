import Link from "next/link";
import { ChevronLeft, ChevronRight, X, Sparkles } from "lucide-react";
import { projectScope } from "@/lib/auth/workspace";
import { listCalendar, listPillars } from "@/lib/data/planning";
import { DocPage } from "@/components/doc-page";
import { SubmitButton } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { addCalendarEntryAction, deleteCalendarEntryAction } from "../planning-actions";

export const metadata = { title: "Calendar" };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function CalendarPage({ params, searchParams }: PageProps<"/w/[id]/p/[pid]/calendar">) {
  const { id, pid } = await params;
  const { m } = await searchParams;
  const { scope, project } = await projectScope(id, pid);

  const now = new Date();
  const [y, mo] = typeof m === "string" && /^\d{4}-\d{2}$/.test(m) ? m.split("-").map(Number) : [now.getFullYear(), now.getMonth() + 1];
  const first = new Date(y, mo - 1, 1);
  const last = new Date(y, mo, 0);
  const lead = (first.getDay() + 6) % 7; // Monday-first
  const cells = Array.from({ length: Math.ceil((lead + last.getDate()) / 7) * 7 }, (_, i) => {
    const d = new Date(y, mo - 1, i - lead + 1);
    return { d, key: iso(d), inMonth: d.getMonth() === mo - 1 };
  });
  const [entries, pillars] = await Promise.all([listCalendar(scope, cells[0].key, cells[cells.length - 1].key), listPillars(scope)]);
  const byDay = new Map<string, typeof entries>();
  entries.forEach((e) => byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]));
  const pillarIdx = new Map(pillars.map((p, i) => [p.id, i]));
  const shade = (pid: string | null) => (pid === null ? "var(--field)" : `color-mix(in srgb, var(--ink) ${20 + ((pillarIdx.get(pid) ?? 0) * 17) % 70}%, var(--paper))`);
  const prev = `${new Date(y, mo - 2, 1).getFullYear()}-${String(new Date(y, mo - 2, 1).getMonth() + 1).padStart(2, "0")}`;
  const next = `${new Date(y, mo, 1).getFullYear()}-${String(new Date(y, mo, 1).getMonth() + 1).padStart(2, "0")}`;
  const today = iso(now);

  return (
    <DocPage
      eyebrow={`${project.name} · Calendar`}
      title={first.toLocaleString("en-GB", { month: "long" })}
      accent={String(y)}
      width={1120}
      action={
        <div className="flex items-center gap-2">
          <button disabled title="The 90-day generator runs as a queued batch job, which is next on the build plan (TASKS P3-1)." className={btnClass("secondary", "sm")}><Sparkles size={14} /> Generate 90 days</button>
          <Link href={`?m=${prev}`} className="w-8 h-8 rounded-[8px] border border-line flex items-center justify-center hover:border-ink" aria-label="Previous month"><ChevronLeft size={15} /></Link>
          <Link href="?" className={btnClass("ghost", "sm")}>Today</Link>
          <Link href={`?m=${next}`} className="w-8 h-8 rounded-[8px] border border-line flex items-center justify-center hover:border-ink" aria-label="Next month"><ChevronRight size={15} /></Link>
        </div>
      }
    >
      <form action={addCalendarEntryAction} className="bg-paper border border-hairline rounded-[14px] p-3 grid grid-cols-2 md:grid-cols-[150px_1fr_160px_130px_auto] gap-2 items-center shadow-[var(--shadow-sm)]">
        <input type="hidden" name="tenantId" value={id} />
        <input type="hidden" name="projectId" value={pid} />
        <input type="date" name="date" required defaultValue={today} className="field !h-9 !py-0" />
        <input name="topic" required placeholder="Topic" className="field !h-9 !py-0" />
        <select name="pillarId" className="field !h-9 !py-0">
          <option value="">No pillar</option>
          {pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select name="channel" className="field !h-9 !py-0">
          <option value="linkedin">LinkedIn</option>
          <option value="instagram">Instagram</option>
          <option value="newsletter">Newsletter</option>
        </select>
        <SubmitButton size="sm" pendingLabel="Adding…">Add slot</SubmitButton>
      </form>

      <div className="mt-6 bg-paper border border-hairline rounded-[14px] overflow-hidden">
        <div className="grid grid-cols-7 border-b border-hairline">
          {DOW.map((d) => <p key={d} className="label-mono text-ink-faint px-3 py-2">{d}</p>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((c, i) => (
            <div key={c.key} className={`min-h-[112px] p-2 border-hairline ${i % 7 ? "border-l" : ""} ${i >= 7 ? "border-t" : ""} ${c.inMonth ? "" : "bg-panel"}`}>
              <p className={`text-[0.75rem] tabular-nums mb-1.5 ${c.key === today ? "inline-flex w-6 h-6 rounded-full bg-accent text-on-ink items-center justify-center font-medium" : c.inMonth ? "text-ink-muted" : "text-ink-faint"}`}>{c.d.getDate()}</p>
              <div className="flex flex-col gap-1">
                {(byDay.get(c.key) ?? []).map((e) => (
                  <div key={e.id} className="group relative rounded-[6px] pl-2 pr-5 py-1 text-[0.72rem] leading-tight bg-panel border-l-[3px]" style={{ borderLeftColor: shade(e.pillarId) }}>
                    <p className="font-medium truncate">{e.topic ?? "Untitled"}</p>
                    <p className="text-ink-faint truncate capitalize">{e.channel ?? ""}{e.pillarName ? ` · ${e.pillarName}` : ""}</p>
                    <form action={deleteCalendarEntryAction} className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100">
                      <input type="hidden" name="tenantId" value={id} />
        <input type="hidden" name="projectId" value={pid} />
                      <input type="hidden" name="id" value={e.id} />
                      <button className="w-4 h-4 flex items-center justify-center text-ink-faint hover:text-accent-ink" aria-label="Remove slot"><X size={11} /></button>
                    </form>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="text-[0.75rem] text-ink-faint mt-3 pb-10">{entries.length} slot{entries.length === 1 ? "" : "s"} this view. Export copies these out; direct publishing isn&apos;t part of v1.</p>
    </DocPage>
  );
}
