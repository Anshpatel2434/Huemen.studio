/**
 * The 90-day calendar's skeleton (brief §4.2, TASKS P3-1): WHICH days and
 * WHICH channel, decided in code so the model never invents a date. The model
 * only fills each slot with a topic, a hook angle and a call to action.
 *
 * Pure: safe to import from client components and tests.
 */

export const CALENDAR_DAYS = 90;

/** Channels a calendar can plan for, with the label shown in the picker. */
export const CALENDAR_CHANNELS = [
  { key: "linkedin", label: "LinkedIn" },
  { key: "instagram", label: "Instagram" },
  { key: "newsletter", label: "Newsletter" },
  { key: "x", label: "X" },
  { key: "threads", label: "Threads" },
] as const;
export type CalendarChannel = (typeof CALENDAR_CHANNELS)[number]["key"];

/** Posting days per week, Monday = 1 … Sunday = 7. Spread out, never bunched. */
const WEEKDAYS: Record<number, number[]> = {
  1: [2],
  2: [2, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 4, 5],
  6: [1, 2, 3, 4, 5, 6],
  7: [1, 2, 3, 4, 5, 6, 7],
};

export interface PlannedSlot {
  /** 1-based, the number the model refers to. */
  slot: number;
  /** YYYY-MM-DD */
  date: string;
  channel: string;
  /** "Mon 20 Oct", for the prompt and the UI. */
  label: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Every publishing slot in the window: the chosen weekdays from `start`
 * (YYYY-MM-DD) for `days` days, channels taken in turn. Dates are computed in
 * UTC from the ISO string, so a server in another time zone plans the same days.
 */
export function planSlots(opts: { start: string; perWeek: number; channels: string[]; days?: number; skip?: Set<string> }): PlannedSlot[] {
  const perWeek = Math.min(7, Math.max(1, Math.round(opts.perWeek)));
  const want = new Set(WEEKDAYS[perWeek]);
  const channels = opts.channels.length ? opts.channels : ["linkedin"];
  const [y, m, d] = opts.start.split("-").map(Number);
  const out: PlannedSlot[] = [];
  for (let i = 0; i < (opts.days ?? CALENDAR_DAYS); i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i));
    const dow = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
    if (!want.has(dow)) continue;
    const iso = isoOf(day);
    if (opts.skip?.has(iso)) continue;
    out.push({
      slot: out.length + 1,
      date: iso,
      channel: channels[out.length % channels.length],
      label: `${DOW[day.getUTCDay()]} ${day.getUTCDate()} ${MON[day.getUTCMonth()]}`,
    });
  }
  return out;
}

/** Today as YYYY-MM-DD in the viewer's zone, for a default start. */
export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
