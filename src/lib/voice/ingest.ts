/**
 * Turning what people upload into corpus pieces (spec file 06 §2, route 2:
 * "the user uploads an export"). Pure — no I/O; the browser reads the file and
 * the server stores what these functions return.
 *
 * Release one reads exports and pastes, not live connections: every source in
 * the spec is reachable this way with nobody's approval (question 7).
 *
 * The private-source rules (file 06 §1) are applied HERE, before anything is
 * stored: only the person's own messages survive, other people's words and
 * quoted replies are stripped, signatures and auto-replies are dropped.
 */

export interface IngestedPiece {
  body: string;
  channel: string;
  visibility: "public" | "private";
  kind: "corpus" | "unguarded";
  publishedAt?: string;
}

export interface IngestResult {
  pieces: IngestedPiece[];
  /** What was read and what was left out, said plainly for the UI. */
  summary: string;
}

/** Minimal RFC 4180 CSV: quoted fields, doubled quotes, newlines in quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

const isoDate = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined;
  const d = new Date(raw.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
};

/**
 * LinkedIn "Get a copy of your data": Shares.csv (posts) and Comments.csv.
 * Reshares with no commentary of their own are skipped (file 06: "exclude
 * reshares without commentary").
 */
export function ingestLinkedIn(csv: string): IngestResult {
  const rows = parseCsv(csv.replace(/^﻿/, ""));
  if (rows.length < 2) return { pieces: [], summary: "That file has no rows." };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name);
  const commentary = col("sharecommentary");
  const message = col("message");
  const date = col("date");

  const isComments = commentary < 0 && message >= 0;
  const textCol = isComments ? message : commentary;
  if (textCol < 0) {
    return { pieces: [], summary: "This isn't a LinkedIn Shares.csv or Comments.csv from the data export." };
  }

  let skipped = 0;
  const pieces: IngestedPiece[] = [];
  for (const r of rows.slice(1)) {
    const body = (r[textCol] ?? "").replace(/""/g, '"').trim();
    if (body.length < 2) { skipped++; continue; }
    pieces.push({
      body,
      channel: isComments ? "linkedin_comment" : "linkedin",
      visibility: "public",
      kind: isComments ? "unguarded" : "corpus",
      publishedAt: isoDate(r[date]),
    });
  }
  const what = isComments ? "comments" : "posts";
  return {
    pieces,
    summary: `${pieces.length} LinkedIn ${what} read${skipped ? `, ${skipped} skipped (reshares with nothing of your own)` : ""}.`,
  };
}

// Android: "12/03/2024, 21:15 - Name: text"   iOS: "[12/03/24, 9:15:01 PM] Name: text"
const WA_LINE =
  /^\[?(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\]?\s*(?:-\s*)?([^:]{1,60}):\s?(.*)$/;
const WA_SKIP = /<media omitted>|<attached:|this message was deleted|messages and calls are end-to-end encrypted/i;

/**
 * WhatsApp "Export chat" (.txt). Keeps ONLY the messages sent by `myName`, and
 * groups a day's messages into one piece, so 200 one-line replies don't count
 * as 200 pieces of writing. Everything anyone else wrote is dropped here and
 * never stored.
 */
export function ingestWhatsApp(text: string, myName: string): IngestResult {
  const me = myName.trim().toLowerCase();
  if (!me) return { pieces: [], summary: "Enter your name exactly as it appears in the chat." };

  const byDay = new Map<string, string[]>();
  let current: { day: string; mine: boolean } | null = null;
  let theirs = 0;
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const m = raw.match(WA_LINE);
    if (m) {
      const [, day, , who, msg] = m;
      const mine = who.trim().toLowerCase() === me;
      current = { day, mine };
      if (!mine) { theirs++; continue; }
      if (WA_SKIP.test(msg)) continue;
      byDay.set(day, [...(byDay.get(day) ?? []), msg.trim()]);
    } else if (current?.mine && raw.trim()) {
      // A continuation line of the person's own multi-line message.
      const lines = byDay.get(current.day) ?? [];
      lines[lines.length - 1] = `${lines[lines.length - 1] ?? ""}\n${raw.trim()}`;
      byDay.set(current.day, lines);
    }
  }

  const pieces: IngestedPiece[] = [...byDay.values()]
    .map((msgs) => msgs.filter(Boolean).join("\n"))
    .filter((b) => b.trim().length > 0)
    .map((body) => ({ body, channel: "whatsapp", visibility: "private" as const, kind: "unguarded" as const }));

  const mineCount = [...byDay.values()].reduce((n, d) => n + d.length, 0);
  if (mineCount === 0) {
    return {
      pieces: [],
      summary: `No messages from "${myName}" found. Use your name exactly as the chat shows it.`,
    };
  }
  return {
    pieces,
    summary: `${mineCount} of your messages read, grouped into ${pieces.length} days. ${theirs} messages from other people were left out and not stored.`,
  };
}

/**
 * One sent email, pasted. Quoted replies, forwarded text and the signature are
 * stripped (file 06: "strip other people's words before storing anything").
 */
export function stripEmail(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .+wrote:\s*$/i.test(line.trim())) break; // the quoted thread starts here
    if (/^-{2,}\s*(original|forwarded) message/i.test(line.trim())) break;
    if (/^From: .+/i.test(line.trim()) && out.length > 0) break;
    if (line.trim() === "--" || line.trim() === "-- ") break; // signature delimiter
    if (/^>/.test(line.trim())) continue;
    if (/^sent from my (iphone|android|phone)/i.test(line.trim())) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

/**
 * A plain text or Markdown file: one piece, unless the file separates pieces
 * with a line of `---` (the common export convention for several posts).
 */
export function ingestText(text: string, channel: string, visibility: "public" | "private"): IngestResult {
  const clean = text.replace(/\r\n/g, "\n").replace(/^﻿/, "");
  const parts = /^\s*(---|\*\*\*)\s*$/m.test(clean)
    ? clean.split(/^\s*(?:---|\*\*\*)\s*$/m)
    : [clean];
  const pieces: IngestedPiece[] = parts
    .map((p) => (channel === "email" ? stripEmail(p) : p.trim()))
    .filter((p) => p.length > 0)
    .map((body) => ({ body, channel, visibility, kind: "corpus" as const }));
  return { pieces, summary: `${pieces.length} ${pieces.length === 1 ? "piece" : "pieces"} read.` };
}

/** The source picker's groups (file 06 §1, G1), with the channel each feeds. */
export const SOURCE_GROUPS: { group: string; private?: boolean; sources: { key: string; label: string; channel: string; how: string }[] }[] = [
  {
    group: "Social",
    sources: [
      { key: "linkedin", label: "LinkedIn", channel: "linkedin", how: "Upload Shares.csv or Comments.csv from LinkedIn's data export, or paste posts" },
      { key: "instagram", label: "Instagram", channel: "instagram", how: "Paste captions" },
      { key: "x", label: "X", channel: "x", how: "Paste posts" },
      { key: "threads", label: "Threads", channel: "threads", how: "Paste posts" },
    ],
  },
  {
    group: "Long-form",
    sources: [
      { key: "newsletter", label: "Newsletter or blog", channel: "newsletter", how: "Upload .txt or .md, or paste. Separate several pieces with a --- line" },
    ],
  },
  {
    group: "Spoken",
    sources: [
      { key: "spoken", label: "Podcast, video or talk", channel: "spoken", how: "Paste or upload a transcript" },
    ],
  },
  {
    group: "Private",
    private: true,
    sources: [
      { key: "email", label: "Sent email", channel: "email", how: "Paste sent emails. Quoted replies and signatures are removed" },
      { key: "whatsapp", label: "WhatsApp", channel: "whatsapp", how: "Upload a chat export (.txt). Only your own messages are kept" },
      { key: "slack", label: "Slack or Teams", channel: "slack", how: "Paste your own messages" },
    ],
  },
  {
    group: "Documents",
    sources: [
      { key: "documents", label: "Proposals, decks, reports", channel: "documents", how: "Upload .txt or .md, or paste" },
    ],
  },
];
