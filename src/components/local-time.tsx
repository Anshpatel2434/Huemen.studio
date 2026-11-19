"use client";

/**
 * A moment shown in the reader's own time zone. The server does not know the
 * zone (Vercel runs in UTC), so it prints the time marked "UTC", and the
 * browser swaps in local time once the page is live (2026-11-19 QA: the audit
 * log showed 08:03 for something done at 13:33 in India, with no zone).
 */
import { useSyncExternalStore } from "react";

const FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };
const noStore = () => () => {};

export function LocalTime({ iso, className }: { iso: string; className?: string }) {
  const live = useSyncExternalStore(noStore, () => true, () => false);
  const at = new Date(iso);
  const text = live
    ? at.toLocaleString("en-GB", FORMAT)
    : `${at.toLocaleString("en-GB", { ...FORMAT, timeZone: "UTC" })} UTC`;
  return <time dateTime={iso} className={className}>{text}</time>;
}
