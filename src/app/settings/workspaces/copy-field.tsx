"use client";

import { Copy } from "lucide-react";
import { useToast } from "@/components/ui";

export function CopyField({ value }: { value: string }) {
  const toast = useToast();
  return (
    <div className="flex items-center gap-2 bg-field rounded-[8px] pl-3 pr-1 h-9 min-w-0">
      <span className="text-[0.78rem] text-accent-ink truncate flex-1 min-w-0">{value}</span>
      <button
        type="button"
        onClick={async () => {
          try { await navigator.clipboard.writeText(value); toast("Link copied"); } catch { toast("Copy failed — select and copy manually"); }
        }}
        className="w-7 h-7 rounded-[6px] flex items-center justify-center hover:bg-paper"
        title="Copy"
      >
        <Copy size={13} />
      </button>
    </div>
  );
}
