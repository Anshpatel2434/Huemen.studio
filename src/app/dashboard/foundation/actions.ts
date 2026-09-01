"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { resolveScope } from "@/lib/auth/scope";
import { saveFoundation, type FoundationForm } from "@/lib/data/foundation";
import { uploadAsset, type AssetKind } from "@/lib/data/assets";

export async function uploadAssetAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const scope = await resolveScope(session);
  const file = formData.get("file") as File | null;
  const kind = String(formData.get("kind") ?? "reference_image") as AssetKind;
  if (file && file.size > 0) await uploadAsset(scope, file, kind);
  revalidatePath("/dashboard/foundation");
}

export async function saveFoundationAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const scope = await resolveScope(session);

  const g = (k: string) => String(formData.get(k) ?? "");
  const form: FoundationForm = {
    niche: g("niche"),
    positioning: g("positioning"),
    offers: g("offers"),
    audience: g("audience"),
    chapters: [0, 1, 2].map((i) => ({
      title: g(`ch${i}_title`),
      body: g(`ch${i}_body`),
    })),
    tone: g("tone"),
    doWords: g("doWords"),
    dontWords: g("dontWords"),
    readingLevel: g("readingLevel"),
    samplePosts: g("samplePosts"),
    palette: g("palette"),
    fonts: g("fonts"),
    imageStyleNotes: g("imageStyleNotes"),
  };

  await saveFoundation(scope, form);
  revalidatePath("/dashboard/foundation");
  revalidatePath("/dashboard");
}
