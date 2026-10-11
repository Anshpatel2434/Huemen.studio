"use client";

/**
 * The two ways a project starts from the workspace, shared by Brand home and
 * the library: the New project modal (blank, or copying another project's
 * brief) and the "describe the brand" prompt that starts a brief from notes.
 */
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Modal, SubmitButton, Field } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { createProjectAction, createFromPromptAction } from "../project-actions";

export const EXAMPLES = [
  "Leadership coach for first-time engineering managers. Direct, warm, a bit contrarian.",
  "Founder building a D2C skincare brand in India, in public. Numbers-first, honest.",
  "Keynote speaker on resilience for HR leaders. Story-led, energetic.",
];

export function NewProjectModal({ tenantId, projects, mode, onClose }: {
  tenantId: string;
  projects: { id: string; name: string }[];
  /** null keeps it closed; "copy" starts from another project's brief. */
  mode: null | "blank" | "copy";
  onClose: () => void;
}) {
  return (
    <Modal open={mode !== null} onClose={onClose} title={mode === "copy" ? "New project from a brief" : "New project"} width={460}>
      <form action={createProjectAction} className="flex flex-col gap-5">
        <input type="hidden" name="tenantId" value={tenantId} />
        <Field label="Project name" required>
          <input name="name" className="field" placeholder="e.g. Q4 thought-leadership push" autoFocus />
        </Field>
        {mode === "copy" ? (
          <Field label="Copy the brief from" hint="Story, voice and visual identity are copied; pillars and content start fresh." required>
            <select name="fromProject" className="field" defaultValue={projects[0]?.id}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        ) : (
          <p className="text-sm text-ink-muted">It starts at Ideate. Content and Visual follow, each unlocking the next.</p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnClass("ghost")}>Cancel</button>
          <SubmitButton pendingLabel="Creating…">Create project</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

/** Describe the brand (or paste labelled workshop notes) and a brief starts from it. */
export function BriefPrompt({ tenantId, autoFocus = false }: { tenantId: string; autoFocus?: boolean }) {
  const [prompt, setPrompt] = useState("");
  return (
    <>
      <form action={createFromPromptAction} className="mt-3 bg-paper border border-hairline rounded-md shadow-[var(--shadow-sm)] flex items-end gap-2 p-2 focus-within:border-ink">
        <input type="hidden" name="tenantId" value={tenantId} />
        <textarea
          name="prompt"
          aria-label="Describe the brand"
          value={prompt}
          autoFocus={autoFocus}
          onChange={(e) => setPrompt(e.target.value)}
          rows={prompt.split("\n").length > 1 ? 4 : 1}
          placeholder={EXAMPLES[0]}
          className="flex-1 resize-none bg-transparent !outline-none text-base px-2 py-2.5 min-h-11 placeholder:text-ink-faint"
        />
        <SubmitButton variant="primary" size="sm" pendingLabel="Starting…" className={!prompt.trim() ? "opacity-40 pointer-events-none" : ""}>
          Start brief <ArrowRight size={15} aria-hidden="true" />
        </SubmitButton>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink-faint mr-1">Try</span>
        {EXAMPLES.map((e) => (
          <button key={e} type="button" onClick={() => setPrompt(e)} className={`${btnClass("secondary", "sm")} !px-4 max-w-[300px] !block truncate`}>{e}</button>
        ))}
      </div>
      <p className="text-sm text-ink-faint mt-2">Paste workshop notes with labels (Niche:, Audience:) for more detail.</p>
    </>
  );
}
