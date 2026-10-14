"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { History, Pencil } from "lucide-react";
import { AgentDots, Badge, Modal, useToast } from "@/components/ui";
import { btnClass } from "@/components/btn";
import type { TemplateEntry } from "@/lib/ai/template-defaults";
import { saveTemplateAction } from "./actions";

type Version = { id: string; tenantId: string | null; version: number; body: string; createdAt: string; createdBy: string | null; workspaceName: string | null };

/**
 * One template: what it says today (the newest global version, or the built-in
 * default), which workspaces override it, and an editor. Saving writes a new
 * version; an older version is restored by saving its body again, so the
 * history is a straight line and every piece's stamp still points at a row.
 */
export function PromptCard({ entry, versions, workspaces }: { entry: TemplateEntry; versions: Version[]; workspaces: { id: string; name: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const globals = versions.filter((v) => v.tenantId === null);
  const overrides = versions.filter((v) => v.tenantId !== null);
  const current = globals[0] ?? null;
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<string>("");
  const [body, setBody] = useState(current?.body ?? entry.defaultBody);
  const [showHistory, setShowHistory] = useState(false);
  const [pending, start] = useTransition();

  // The newest version for the chosen scope, so the editor opens on what runs there.
  const pick = (tenantId: string) => {
    setScope(tenantId);
    const v = tenantId ? overrides.find((o) => o.tenantId === tenantId) : current;
    setBody(v?.body ?? current?.body ?? entry.defaultBody);
  };

  const save = () =>
    start(async () => {
      try {
        const v = await saveTemplateAction({ key: entry.key, body, tenantId: scope || null });
        setOpen(false);
        toast(`Saved as version ${v}${scope ? " for that workspace" : ""}`);
        router.refresh();
      } catch {
        toast("Couldn't save that. Your text is still here.", "danger");
      }
    });

  const overriddenIn = Array.from(new Map(overrides.map((o) => [o.tenantId, o.workspaceName])).values());

  return (
    <article className="bg-paper border border-hairline rounded-md p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-medium">{entry.label}</h2>
            <Badge tone={current ? "accent" : "neutral"}>{current ? `v${current.version}` : "built-in"}</Badge>
            {overriddenIn.length > 0 && <Badge tone="dark">{overriddenIn.length === 1 ? `override: ${overriddenIn[0]}` : `${overriddenIn.length} overrides`}</Badge>}
          </div>
          <p className="text-xs text-ink-muted mt-1">{entry.about} <span className="font-mono text-ink-faint">{entry.key}</span></p>
        </div>
        <button type="button" onClick={() => { pick(""); setOpen(true); }} className={btnClass("secondary", "sm")}><Pencil size={14} aria-hidden="true" /> Edit</button>
      </div>
      <p className="text-sm text-ink-muted leading-relaxed mt-3 line-clamp-3 whitespace-pre-wrap">{current?.body ?? entry.defaultBody}</p>
      {current && (
        <p className="text-xs text-ink-faint mt-2">
          Saved {new Date(current.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}{current.createdBy ? ` by ${current.createdBy}` : ""}{globals.length > 1 ? ` · ${globals.length} versions` : ""}
        </p>
      )}

      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={`Edit: ${entry.label}`}
        width={720}
        footer={
          <>
            <button type="button" onClick={() => setOpen(false)} disabled={pending} className={btnClass("secondary")}>Cancel</button>
            <button type="button" onClick={save} disabled={pending || !body.trim()} className={btnClass("primary")}>
              {pending ? <><AgentDots /> Saving…</> : `Save as v${(scope ? (overrides.filter((o) => o.tenantId === scope)[0]?.version ?? 0) : (current?.version ?? 0)) + 1}`}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {workspaces.length > 0 && (
            <label className="block">
              <span className="hu-label !flex mb-2">Applies to</span>
              <select value={scope} onChange={(e) => pick(e.target.value)} className="field">
                <option value="">Every workspace (global)</option>
                {workspaces.map((w) => <option key={w.id} value={w.id}>Only {w.name}{overrides.some((o) => o.tenantId === w.id) ? " (has an override)" : ""}</option>)}
              </select>
            </label>
          )}
          <label className="block">
            <span className="hu-label !flex mb-2">How to write</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9} className="field font-mono text-sm leading-relaxed" spellCheck />
          </label>
          <p className="text-xs text-ink-faint leading-relaxed">
            The brand context (voice, guardrails, samples) is appended after this, and the output format is added by the code. Say how to think and what to value; leave the shape alone.
          </p>
          {(globals.length > 0 || overrides.length > 0) && (
            <div>
              <button type="button" onClick={() => setShowHistory((s) => !s)} className="inline-flex items-center gap-1.5 text-sm text-accent-ink hover:underline min-h-11">
                <History size={14} aria-hidden="true" /> {showHistory ? "Hide" : "Show"} history ({versions.length})
              </button>
              {showHistory && (
                <ul className="mt-2 border border-hairline rounded-md divide-y divide-[var(--hairline)] max-h-64 overflow-y-auto">
                  {versions.map((v) => (
                    <li key={v.id} className="p-3 flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-xs text-ink-muted">
                        <span className="font-medium text-ink">v{v.version}</span>
                        <span>{v.workspaceName ? `Only ${v.workspaceName}` : "Global"}</span>
                        <span>· {new Date(v.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                        <span className="flex-1" />
                        <button type="button" onClick={() => { setScope(v.tenantId ?? ""); setBody(v.body); }} className="text-accent-ink hover:underline min-h-11">Load into editor</button>
                      </div>
                      <p className="text-xs text-ink-muted line-clamp-2 whitespace-pre-wrap">{v.body}</p>
                    </li>
                  ))}
                  <li className="p-3 text-xs text-ink-faint">v0 · Built-in default <button type="button" onClick={() => { setBody(entry.defaultBody); }} className="text-accent-ink hover:underline ml-2 min-h-11">Load into editor</button></li>
                </ul>
              )}
            </div>
          )}
        </div>
      </Modal>
    </article>
  );
}
