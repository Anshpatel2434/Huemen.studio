"use client";

/**
 * The agent panel ("Ask Huemen…"). A command (draft, add a pillar, capture an
 * idea) runs at once through askAgent. Anything else is a question: its answer
 * streams in from agent/stream as OpenUI Lang and renders as Huemen's own
 * cards (lib/agent-ui), building up while it is written. A card's button
 * raises a fixed action; asking and opening a page happen here, and anything
 * that writes goes through runAgentAction, which re-validates it.
 */
import "@/lib/agent-ui/no-devtools";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { ArrowUp, Check } from "lucide-react";
import { Renderer, type ActionEvent } from "@openuidev/react-lang";
import { AgentDots, btnClass } from "@/components/ui";
import { liveDraftHref } from "@/components/live-draft";
import { agentLibrary, BriefStatusContext } from "@/lib/agent-ui/library";
import { PAGES } from "@/lib/agent-ui/spec";
import type { BriefStatus } from "@/lib/agent-ui/status";
import { parseAgentAction } from "@/lib/agent-ui/actions";
import { askAgent, runAgentAction, type AgentReply } from "./agent-actions";

type Msg =
  | { role: "me"; text: string }
  | { role: "agent"; text: string; tasks?: AgentReply["tasks"] }
  /** A streamed answer: `ui` is the OpenUI Lang so far; `status` is the brief's score and gaps, from the server. */
  | { role: "answer"; ui: string; streaming: boolean; failed?: string; status?: BriefStatus; q?: { text: string; earlier: string[] } };

const FALLBACK = "I couldn't lay that answer out. Ask it another way and I'll try again.";

/**
 * The conversation is kept in this tab, per project, so a reload or a visit to
 * another page gives it back (2026-11-19 QA: it was gone after a reload). Tab
 * storage, not the account: it goes when the tab closes, and never reaches
 * another device or person. The opening line is not kept; it says how the brief
 * stands now. An answer cut off by the reload is kept as far as it got.
 */
const KEEP = 40;
const chatKey = (projectId: string) => `huemen:agent-chat:${projectId}`;
const isMsg = (m: unknown): m is Msg => {
  const r = (m ?? {}) as { role?: unknown; text?: unknown; ui?: unknown };
  return (r.role === "me" || r.role === "agent") ? typeof r.text === "string" : r.role === "answer" && typeof r.ui === "string";
};
const subscribeNever = () => () => {};
function readChatRaw(projectId: string): string | null {
  try { return sessionStorage.getItem(chatKey(projectId)); } catch { return null; }
}
function parseChat(raw: string | null): Msg[] {
  try {
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(isMsg).slice(-KEEP).map((m) => (m.role === "answer" ? { ...m, streaming: false } : m)) : [];
  } catch {
    return [];
  }
}
function saveChat(projectId: string, list: Msg[]) {
  try {
    if (list.length) sessionStorage.setItem(chatKey(projectId), JSON.stringify(list.slice(-KEEP)));
    else sessionStorage.removeItem(chatKey(projectId));
  } catch { /* a private window or a full store: the conversation just isn't kept */ }
}

/**
 * The piece an edit is about: the one in the URL (Content opens ?item=<id>),
 * else the one last opened in this project (the Content board keeps it, since
 * a click on the canvas closes the editor and drops the URL param).
 */
function openPieceId(projectId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("item");
    if (fromUrl) return fromUrl;
    return sessionStorage.getItem(`huemen:open-piece:${projectId}`);
  } catch {
    return null;
  }
}

export function AgentPanel({ workspaceId, projectId, degraded, completeness }: { workspaceId: string; projectId: string; degraded: boolean; completeness: number }) {
  const router = useRouter();
  const greeting: Msg = {
    role: "agent",
    text: degraded
      ? `This brief is ${completeness}% complete. I can draft, but it will read generic until the brief is filled in. Ask me what's missing.`
      : "Brief loaded. Ask what to write next, plan your week, or get hooks. I can also draft a post, add a pillar or capture an idea.",
  };
  // The kept conversation, read once the page is live (the server has no tab storage:
  // it renders the opening line alone). Until something new is said, the view is the
  // kept one; from then on it is this tab's own, saved as it changes.
  const keptRaw = useSyncExternalStore(subscribeNever, () => readChatRaw(projectId), () => null);
  const [own, setOwn] = useState<Msg[] | null>(null);
  const msgs: Msg[] = own ?? [greeting, ...parseChat(keptRaw)];
  const setMsgs = (next: Msg[] | ((m: Msg[]) => Msg[])) =>
    setOwn((prev) => {
      const base = prev ?? [greeting, ...parseChat(readChatRaw(projectId))];
      return typeof next === "function" ? next(base) : next;
    });
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const [streaming, setStreaming] = useState(false);
  const busy = pending || streaming;
  useEffect(() => { if (own && !busy) saveChat(projectId, own.slice(1)); }, [own, busy, projectId]);
  const startOver = () => { setOwn([greeting]); saveChat(projectId, []); setDraft(""); };
  const endRef = useRef<HTMLDivElement>(null);
  // Scrolls to the newest line when one is added or an answer grows (the count and the last line's length say so).
  const lastLen = (() => { const m = msgs.at(-1); return m ? (m.role === "answer" ? m.ui.length : m.text.length) : 0; })();
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length, lastLen, busy]);

  const base = `/w/${workspaceId}/p/${projectId}`;
  const asked = () => msgs.filter((m): m is Extract<Msg, { role: "me" }> => m.role === "me").map((m) => m.text);

  /** Streams one answer into the last message, a line of NDJSON at a time. */
  const streamAnswer = async (question: string, earlier: string[]) => {
    setStreaming(true);
    let at = -1;
    setMsgs((m) => { at = m.length; return [...m, { role: "answer", ui: "", streaming: true, q: { text: question, earlier } }]; });
    const patch = (fn: (a: Extract<Msg, { role: "answer" }>) => Extract<Msg, { role: "answer" }>) =>
      setMsgs((m) => m.map((x, i) => (i === at && x.role === "answer" ? fn(x) : x)));
    try {
      const res = await fetch(`${base}/agent/stream`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: question, earlier }) });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as
            | { t: "status"; score: number; open: string[] }
            | { t: "d"; v: string }
            | { t: "done"; ok: boolean }
            | { t: "error"; message: string };
          if (ev.t === "status") patch((a) => ({ ...a, status: { score: ev.score, open: ev.open } }));
          else if (ev.t === "d") patch((a) => ({ ...a, ui: a.ui + ev.v }));
          else if (ev.t === "done") patch((a) => ({ ...a, streaming: false, failed: ev.ok ? undefined : FALLBACK }));
          else patch((a) => ({ ...a, streaming: false, failed: ev.message }));
        }
      }
      patch((a) => ({ ...a, streaming: false }));
    } catch {
      patch((a) => ({ ...a, streaming: false, failed: "That didn't go through. Ask again." }));
    } finally {
      setStreaming(false);
    }
  };

  const ask = (text: string) => {
    if (!text || busy) return;
    const earlier = asked();
    setMsgs((m) => [...m, { role: "me", text }]);
    start(async () => {
      try {
        const r = await askAgent(workspaceId, projectId, text, openPieceId(projectId));
        if (r.stream) {
          void streamAnswer(text, earlier);
          return;
        }
        setMsgs((m) => [...m, { role: "agent", text: r.failed ? `${r.text} Your message is back in the box.` : r.text, tasks: r.tasks }]);
        if (r.failed) setDraft((d) => d || text);
        else router.refresh();
      } catch {
        setMsgs((m) => [...m, { role: "agent", text: "That didn't go through. Your message is back in the box, so try again." }]);
        setDraft(text);
      }
    });
  };

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    ask(text);
  };

  /** A card's button. Only allow-listed actions run; the server checks again. */
  const onAction = (ev: ActionEvent) => {
    const action = parseAgentAction({ type: ev.type, params: ev.params });
    if (!action || busy) return;
    if (action.type === "ask") return ask(action.params.text);
    if (action.type === "open") {
      const p = PAGES[action.params.page];
      router.push(p.scope === "project" ? `${base}/${p.path}` : `/w/${workspaceId}/${p.path}`);
      return;
    }
    setMsgs((m) => [...m, { role: "me", text: ev.humanFriendlyMessage }]);
    start(async () => {
      try {
        const r = await runAgentAction(workspaceId, projectId, action);
        setMsgs((m) => [...m, { role: "agent", text: r.text, tasks: r.tasks }]);
        // A draft is written live on the Content canvas, beside this panel.
        if (r.liveDraft) router.push(liveDraftHref(base, r.liveDraft));
        else router.refresh();
      } catch {
        setMsgs((m) => [...m, { role: "agent", text: "That didn't go through. Press it again in a moment." }]);
      }
    });
  };

  const waiting = pending || (streaming && msgs.at(-1)?.role === "answer" && !(msgs.at(-1) as Extract<Msg, { role: "answer" }>).ui);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3" role="log" aria-live="polite" aria-label="Assistant conversation">
        {msgs.map((m, i) => {
          if (m.role === "me") return <div key={i} className="self-end max-w-[90%] bg-field rounded-md px-2.5 py-1.5 text-sm fade-up">{m.text}</div>;
          if (m.role === "answer") {
            if (!m.ui && !m.failed) return null;
            return (
              <div key={i} className="fade-up" aria-busy={m.streaming}>
                {m.ui && (
                  <BriefStatusContext.Provider value={m.status ?? null}>
                    <Renderer response={m.ui} library={agentLibrary} isStreaming={m.streaming} onAction={onAction} />
                  </BriefStatusContext.Provider>
                )}
                {m.failed && (
                  <div className="mt-1 flex flex-col items-start gap-1.5">
                    <p className="text-sm text-ink-muted">{m.failed}</p>
                    {/* A refused or failed answer can be asked again in one press (2026-11-18: rate limits on the free tier). */}
                    {m.q && i === msgs.length - 1 && (
                      <button type="button" disabled={busy} onClick={() => { const q = m.q!; setMsgs((all) => all.filter((_, j) => j !== i)); void streamAnswer(q.text, q.earlier); }} className={btnClass("secondary", "sm")}>Try again</button>
                    )}
                  </div>
                )}
              </div>
            );
          }
          return (
            <div key={i} className="text-sm leading-relaxed fade-up">
              <p>{m.text}</p>
              {m.tasks && m.tasks.length > 0 && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <p className="text-xs text-ink-faint">Carried out {m.tasks.length} task{m.tasks.length > 1 ? "s" : ""}</p>
                  {m.tasks.map((t, j) => {
                    const card = (
                      <span className="flex items-center gap-2 border border-hairline rounded-md px-2 py-1.5 hover:border-line">
                        <span className="w-6 h-6 rounded-sm bg-field flex items-center justify-center shrink-0"><Check size={12} /></span>
                        <span className="min-w-0"><span className="block text-xs font-medium truncate">{t.label}</span>{t.detail && <span className="block text-xs text-ink-faint truncate">{t.detail}</span>}</span>
                      </span>
                    );
                    return t.href ? <Link key={j} href={t.href}>{card}</Link> : <div key={j}>{card}</div>;
                  })}
                </div>
              )}
            </div>
          );
        })}
        {waiting && <div role="status" className="flex items-center gap-2 bg-accent-soft text-accent-ink rounded-md px-2.5 py-2 text-xs font-medium fade-in"><AgentDots /> Working from your brief…</div>}
        <div ref={endRef} />
      </div>
      <div className="p-2.5 border-t border-hairline">
        <div className="bg-panel border border-hairline rounded-md focus-within:border-ink">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={3}
            placeholder="Ask Huemen…"
            className="w-full resize-none bg-transparent px-2.5 pt-2 text-sm outline-none placeholder:text-ink-faint"
          />
          <div className="flex justify-end px-1.5 pb-1.5">
            <button onClick={send} disabled={!draft.trim() || busy} className="hu-iconbtn !bg-ink !text-on-ink hover:opacity-90 disabled:!bg-active disabled:!text-ink-faint" aria-label="Send"><ArrowUp size={17} aria-hidden="true" /></button>
          </div>
        </div>
        <p className="text-xs text-ink-faint text-center mt-1.5">
          Powered by this project&apos;s brief
          {msgs.length > 1 && !busy && <> · <button type="button" onClick={startOver} className="underline underline-offset-2 hover:text-ink">Start over</button></>}
        </p>
      </div>
    </div>
  );
}
