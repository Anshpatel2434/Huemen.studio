"use client";

/**
 * A form's submit button that asks first (the one confirm dialog, never the
 * browser's). For one-click actions that are hard to take back from the other
 * side: turning someone's access off, archiving a workspace.
 */
import { useRef, useState, type ReactNode } from "react";
import { ConfirmModal } from "@/components/confirm-modal";
import { btnClass } from "@/components/btn";

export function ConfirmSubmit({ children, title, body, confirmLabel, variant = "ghost", danger = true }: {
  children: ReactNode;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  variant?: "ghost" | "secondary" | "danger";
  danger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={button} type="button" onClick={() => setOpen(true)} className={btnClass(variant, "sm")} disabled={sent}>
        {sent ? "…" : children}
      </button>
      <ConfirmModal
        open={open}
        title={title}
        confirmLabel={confirmLabel}
        danger={danger}
        onClose={() => setOpen(false)}
        onConfirm={() => { setOpen(false); setSent(true); button.current?.form?.requestSubmit(); }}
      >
        {body}
      </ConfirmModal>
    </>
  );
}
