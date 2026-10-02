"use server";

/**
 * Check (Flow 3): paste anything, see how close it is to the person's voice.
 *
 * Three calls, cheapest first. The code check is instant and free; the line
 * findings and the rewrite are model calls, run only when asked for. All three
 * read the same voice through the same paths as drafting (INV-2).
 */
import { actionScope } from "@/lib/auth/workspace";
import { checkText, judgeText, rewriteText, type CheckOutcome } from "@/lib/data/check";
import { userMessage } from "@/lib/ai/errors";
import type { JudgeResult } from "@/lib/ai/tasks";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_CHARS = 20_000;

async function guarded<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}

export async function checkAction(tenantId: string, text: string, platform: string | null): Promise<Result<CheckOutcome>> {
  const scope = await actionScope(tenantId);
  return guarded(() => checkText(scope, text.slice(0, MAX_CHARS), platform));
}

export async function judgeAction(tenantId: string, text: string, platform: string | null): Promise<Result<JudgeResult["findings"]>> {
  const scope = await actionScope(tenantId);
  return guarded(() => judgeText(scope, text.slice(0, MAX_CHARS), platform));
}

export async function rewriteAction(tenantId: string, text: string, platform: string | null): Promise<Result<string>> {
  const scope = await actionScope(tenantId);
  return guarded(() => rewriteText(scope, text.slice(0, MAX_CHARS), platform));
}
