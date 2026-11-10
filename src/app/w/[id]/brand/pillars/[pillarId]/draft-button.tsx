"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Plus } from "lucide-react";
import { AgentDots } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { startFromPillarAction } from "../actions";

/** Start a new piece under this pillar: it opens at Ideate with the pillar picked. */
export function DraftFromPillar({ tenantId, name }: { tenantId: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(async () => router.push(await startFromPillarAction(tenantId, name)))} className={btnClass("primary")}>
      {pending ? <AgentDots /> : <Plus size={15} aria-hidden="true" />} Write a piece from this pillar
    </button>
  );
}
