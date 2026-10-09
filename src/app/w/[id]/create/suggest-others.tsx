"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { btnClass } from "@/components/btn";
import { suggestOthersAction } from "./actions";

export function SuggestOthers({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3">
      {error && <span role="alert" className="text-sm text-danger">{error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => {
          setError(null);
          const r = await suggestOthersAction(tenantId);
          if (!r.ok) setError(r.error);
          router.refresh();
        })}
        className={btnClass("ghost", "sm")}
      >
        <RefreshCw size={14} className={pending ? "animate-spin" : ""} aria-hidden="true" /> Suggest others
      </button>
    </div>
  );
}
