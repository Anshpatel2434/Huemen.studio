"use client";

import { useState } from "react";
import { ClipboardPaste, Copy, Plus } from "lucide-react";
import { Modal } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { BriefPrompt, NewProjectModal } from "./create-project";
import { WhatsNew } from "./whats-new";

/**
 * Brand home's create actions: the same three ways in as the library (paste
 * notes, copy a brief, blank project), plus the one-time "what's new" note.
 */
export function HomeActions({ tenantId, projects, showWhatsNew }: {
  tenantId: string;
  projects: { id: string; name: string }[];
  showWhatsNew: boolean;
}) {
  const [creating, setCreating] = useState<null | "blank" | "copy">(null);
  const [notes, setNotes] = useState(false);
  return (
    <>
      {showWhatsNew && <WhatsNew onStart={() => setCreating("blank")} />}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setNotes(true)} className={btnClass("ghost", "sm")}><ClipboardPaste size={15} aria-hidden="true" /> Paste notes</button>
        <button type="button" onClick={() => setCreating("copy")} disabled={projects.length === 0} className={btnClass("secondary", "sm")}><Copy size={15} aria-hidden="true" /> From a brief</button>
        <button type="button" onClick={() => setCreating("blank")} className={btnClass("primary", "sm")}><Plus size={15} aria-hidden="true" /> New project</button>
      </div>
      <NewProjectModal tenantId={tenantId} projects={projects} mode={creating} onClose={() => setCreating(null)} />
      <Modal open={notes} onClose={() => setNotes(false)} title="Describe the brand and start the brief" width={640}>
        <BriefPrompt tenantId={tenantId} autoFocus />
      </Modal>
    </>
  );
}

/** "New project" inside an empty state. */
export function NewProjectButton({ tenantId }: { tenantId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btnClass("primary")}><Plus size={15} aria-hidden="true" /> New project</button>
      <NewProjectModal tenantId={tenantId} projects={[]} mode={open ? "blank" : null} onClose={() => setOpen(false)} />
    </>
  );
}
