"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { saveTemplate } from "@/lib/data/admin";
import { TEMPLATE_CATALOG } from "@/lib/ai/template-defaults";

/** Save a template body as a new version, global or for one workspace. Returns the version. */
export async function saveTemplateAction(input: { key: string; body: string; tenantId: string | null }): Promise<number> {
  const session = await requireSession();
  if (!TEMPLATE_CATALOG.some((t) => t.key === input.key)) throw new Error("unknown template");
  const version = await saveTemplate(session, input);
  revalidatePath("/settings/prompts");
  return version;
}
