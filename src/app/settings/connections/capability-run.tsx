"use client";

/**
 * Running one capability: import sent email, pick documents with the Google
 * Picker, choose upcoming events to keep as ideas, or import LinkedIn posts.
 * Every run says what it did in numbers, and every failure says what to do.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, FileText } from "lucide-react";
import { btnClass } from "@/components/btn";
import { AgentDots } from "@/components/ui";
import { PLATFORM_RULES } from "@/lib/voice/platforms";
import type { CapabilityKey } from "@/lib/integrations/providers";
import type { UpcomingEvent } from "@/lib/integrations/google";
import {
  importDocsAction, importGmailAction, importLinkedInPostsAction, importYouTubeAction, listEventsAction, pickerConfigAction, saveEventsAsIdeasAction,
} from "./actions";

type Picked = { id: string; name: string; channel: string; published: boolean };

/* The Google Picker is loaded from Google on demand; these are the bits used. */
interface PickerBuilder {
  addView(v: unknown): PickerBuilder;
  setOAuthToken(t: string): PickerBuilder;
  setDeveloperKey(k: string): PickerBuilder;
  setAppId(a: string): PickerBuilder;
  enableFeature(f: unknown): PickerBuilder;
  setCallback(cb: (d: { action: string; docs?: { id: string; name: string }[] }) => void): PickerBuilder;
  build(): { setVisible(v: boolean): void };
}
type GooglePicker = {
  picker: {
    DocsView: new () => { setMimeTypes(t: string): unknown; setMode(m: unknown): unknown };
    PickerBuilder: new () => PickerBuilder;
    Feature: { MULTISELECT_ENABLED: unknown };
    DocsViewMode: { LIST: unknown };
    Action: { PICKED: string };
  };
};

function loadPicker(): Promise<GooglePicker> {
  const w = window as unknown as { gapi?: { load(n: string, cb: () => void): void }; google?: GooglePicker };
  return new Promise((resolve, reject) => {
    const ready = () => w.gapi!.load("picker", () => (w.google ? resolve(w.google) : reject(new Error("picker"))));
    if (w.gapi) return ready();
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.async = true;
    s.onload = ready;
    s.onerror = () => reject(new Error("script"));
    document.head.appendChild(s);
  });
}

const CHANNELS = ["newsletter", "linkedin", "bio", "spoken", "email"];

export function CapabilityRun({ tenantId, cap }: { tenantId: string; cap: CapabilityKey }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [events, setEvents] = useState<UpcomingEvent[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);

  const say = (ok: boolean, text: string) => { setMsg({ ok, text }); router.refresh(); };

  const runGmail = () => start(async () => {
    const r = await importGmailAction(tenantId);
    if (!r.ok) return say(false, r.error);
    say(true, `Read ${r.value.read} sent ${r.value.read === 1 ? "email" : "emails"}; ${r.value.added} new ${r.value.added === 1 ? "piece" : "pieces"} kept. Short replies and quoted text were left out.`);
  });

  const openPicker = () => start(async () => {
    setMsg(null);
    const cfg = await pickerConfigAction(tenantId);
    if (!cfg.ok) return say(false, cfg.error);
    try {
      const g = await loadPicker();
      const view = new g.picker.DocsView();
      view.setMimeTypes("application/vnd.google-apps.document,application/vnd.google-apps.presentation");
      view.setMode(g.picker.DocsViewMode.LIST);
      new g.picker.PickerBuilder()
        .addView(view)
        .enableFeature(g.picker.Feature.MULTISELECT_ENABLED)
        .setOAuthToken(cfg.value.token)
        .setDeveloperKey(cfg.value.apiKey)
        .setAppId(cfg.value.appId)
        .setCallback((d) => {
          if (d.action === g.picker.Action.PICKED && d.docs) {
            setPicked((cur) => [
              ...cur,
              ...d.docs!.filter((x) => !cur.some((c) => c.id === x.id)).map((x) => ({ id: x.id, name: x.name, channel: "newsletter", published: true })),
            ]);
          }
        })
        .build()
        .setVisible(true);
    } catch {
      setMsg({ ok: false, text: "The Google file picker didn't load. Check your connection and try again." });
    }
  });

  const importDocs = () => start(async () => {
    const r = await importDocsAction(tenantId, picked.map(({ id, channel, published }) => ({ id, channel, published })));
    if (!r.ok) return say(false, r.error);
    setPicked([]);
    say(true, `${r.value.added} new ${r.value.added === 1 ? "piece" : "pieces"} kept.${r.value.skipped.length ? ` Skipped: ${r.value.skipped.join(", ")}.` : ""}`);
  });

  const loadEvents = () => start(async () => {
    const r = await listEventsAction(tenantId);
    if (!r.ok) return say(false, r.error);
    setEvents(r.value);
    setChosen([]);
  });

  const saveIdeas = () => start(async () => {
    const pick = (events ?? []).filter((e) => chosen.includes(e.id));
    const r = await saveEventsAsIdeasAction(tenantId, pick);
    if (!r.ok) return say(false, r.error);
    setEvents(null);
    say(true, `${r.value} ${r.value === 1 ? "idea" : "ideas"} saved to your inbox.`);
  });

  const runYouTube = () => start(async () => {
    const r = await importYouTubeAction(tenantId);
    if (!r.ok) return say(false, r.error);
    say(true, r.value.videos
      ? `Read captions from ${r.value.videos} ${r.value.videos === 1 ? "video" : "videos"}; ${r.value.added} new ${r.value.added === 1 ? "piece" : "pieces"} kept.`
      : "No videos with captions on your channel yet.");
  });

  const runPosts = () => start(async () => {
    const r = await importLinkedInPostsAction(tenantId);
    if (!r.ok) return say(false, r.error);
    say(true, `${r.value.added} new ${r.value.added === 1 ? "post" : "posts"} kept.`);
  });

  return (
    <div className="flex flex-col gap-3">
      {cap === "gmail" && (
        <button type="button" disabled={pending} onClick={runGmail} className={`${btnClass("secondary", "sm")} self-start`}>
          {pending ? <><AgentDots /> Reading sent email</> : "Import sent email"}
        </button>
      )}

      {cap === "docs" && (
        <>
          <button type="button" disabled={pending} onClick={openPicker} className={`${btnClass("secondary", "sm")} self-start`}>
            <FileText size={14} aria-hidden="true" /> Pick documents
          </button>
          {picked.length > 0 && (
            <div className="flex flex-col gap-2 border border-hairline rounded-[10px] p-3">
              {picked.map((f, i) => (
                <div key={f.id} className="flex flex-wrap items-center gap-2 text-[0.85rem]">
                  <span className="flex-1 min-w-0 truncate">{f.name}</span>
                  <select
                    value={f.channel}
                    onChange={(e) => setPicked(picked.map((x, j) => (j === i ? { ...x, channel: e.target.value } : x)))}
                    className="field !w-auto min-h-11"
                    aria-label={`Where ${f.name} was written for`}
                  >
                    {CHANNELS.map((c) => <option key={c} value={c}>{PLATFORM_RULES[c]?.label ?? c}</option>)}
                  </select>
                  <label className="flex items-center gap-1.5 min-h-11 text-[0.8rem]">
                    <input type="checkbox" checked={f.published} onChange={(e) => setPicked(picked.map((x, j) => (j === i ? { ...x, published: e.target.checked } : x)))} />
                    Published
                  </label>
                </div>
              ))}
              <p className="text-[0.75rem] text-ink-faint">Unpublished documents are measured but never quoted in a draft.</p>
              <button type="button" disabled={pending} onClick={importDocs} className={`${btnClass("primary", "sm")} self-start`}>
                {pending ? <><AgentDots /> Reading</> : `Import ${picked.length} ${picked.length === 1 ? "document" : "documents"}`}
              </button>
            </div>
          )}
        </>
      )}

      {cap === "calendar" && (
        <>
          {!events && (
            <button type="button" disabled={pending} onClick={loadEvents} className={`${btnClass("secondary", "sm")} self-start`}>
              {pending ? <><AgentDots /> Looking ahead</> : "See the next 60 days"}
            </button>
          )}
          {events && (
            <div className="flex flex-col gap-1.5 border border-hairline rounded-[10px] p-3">
              {events.length === 0 && <p className="text-[0.85rem] text-ink-muted">Nothing coming up that looks like content.</p>}
              {events.map((e) => (
                <label key={e.id} className="flex items-start gap-2 min-h-11 text-[0.85rem] cursor-pointer">
                  <input type="checkbox" className="mt-1" checked={chosen.includes(e.id)} onChange={() => setChosen(chosen.includes(e.id) ? chosen.filter((x) => x !== e.id) : [...chosen, e.id])} />
                  <span><span className="font-mono text-[0.75rem] text-ink-faint tabular-nums">{e.date}</span> {e.title}</span>
                </label>
              ))}
              <div className="flex gap-2 pt-1">
                <button type="button" disabled={pending || !chosen.length} onClick={saveIdeas} className={btnClass("primary", "sm")}>Save {chosen.length || ""} as ideas</button>
                <button type="button" onClick={() => setEvents(null)} className={btnClass("ghost", "sm")}>Close</button>
              </div>
            </div>
          )}
        </>
      )}

      {cap === "youtube" && (
        <button type="button" disabled={pending} onClick={runYouTube} className={`${btnClass("secondary", "sm")} self-start`}>
          {pending ? <><AgentDots /> Reading captions</> : "Import captions"}
        </button>
      )}

      {cap === "posts" && (
        <button type="button" disabled={pending} onClick={runPosts} className={`${btnClass("secondary", "sm")} self-start`}>
          {pending ? <><AgentDots /> Reading posts</> : "Import my posts"}
        </button>
      )}

      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`text-[0.82rem] flex items-start gap-1.5 ${msg.ok ? "text-ok" : "text-danger"}`}>
          {msg.ok && <Check size={13} className="mt-0.5 shrink-0" aria-hidden="true" />} {msg.text}
        </p>
      )}
    </div>
  );
}
