"use server";

/**
 * The brand's own actions: the brief, uploads, pasted notes and the strategy
 * questions. Workspace-level since build step 3 — the brand is set once in
 * onboarding and every piece reads it, so none of this belongs to a project.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionScope } from "@/lib/auth/workspace";
import {
  loadFoundation, saveBriefAnswers, saveFoundation, saveVisualIdentity, type FoundationForm, type VisualIdentity,
} from "@/lib/data/foundation";
import { AssetError, deleteAsset, storeAsset, uploadAsset, type AssetKind } from "@/lib/data/assets";
import { takeIncoming } from "@/lib/storage/upload";
import { safeGet } from "@/lib/integrations/web";
import { extractSiteBrand, type SiteBrand } from "@/lib/visual/core";
import { generatePillars } from "@/lib/data/pipeline";
import { loadBrandContext } from "@/lib/context/context-loader";
import { parseIntake, mergeIntake } from "@/lib/intake/parse";
import { applyAnswers, buildQuestions, MIN_SEEDS } from "@/lib/brief/questions";

async function ctx(fd: FormData) {
  const t = String(fd.get("tenantId"));
  // Onboarding posts `back` so a step returns to the stepper, not the brand page.
  const back = String(fd.get("back") ?? "");
  return { scope: await actionScope(t), base: `/w/${t}/brand`, back: back.startsWith(`/w/${t}/`) ? back : null };
}

function formFrom(fd: FormData): FoundationForm {
  const g = (k: string) => String(fd.get(k) ?? "");
  return {
    niche: g("niche"), positioning: g("positioning"), offers: g("offers"), audience: g("audience"),
    chapters: [0, 1, 2].map((i) => ({ title: g(`ch${i}_title`), body: g(`ch${i}_body`) })),
    tone: g("tone"), doWords: g("doWords"), dontWords: g("dontWords"), readingLevel: g("readingLevel"),
    samplePosts: g("samplePosts"), palette: g("palette"), fonts: g("fonts"), imageStyleNotes: g("imageStyleNotes"),
  };
}

export async function saveFoundationAction(fd: FormData): Promise<void> {
  const { scope, base, back } = await ctx(fd);
  await saveFoundation(scope, formFrom(fd));
  revalidatePath(`/w/${scope.tenantId}`, "layout");
  redirect(back ?? `${base}?saved=1`);
}

export async function uploadAssetAction(fd: FormData): Promise<void> {
  const { scope } = await ctx(fd);
  const kind = String(fd.get("kind") ?? "reference_image") as AssetKind;
  // A file sent ahead to storage (lib/upload-client) arrives as its key; a
  // plain form still posts the file itself, which only works under 1 MB.
  const key = fd.get("key");
  if (key) {
    const bytes = await takeIncoming(scope.tenantId, key, "asset");
    if (!bytes) throw new AssetError("That upload didn't arrive or has expired. Choose the file again.");
    await storeAsset(scope, bytes, kind);
  } else {
    const file = fd.get("file") as File | null;
    if (file && file.size > 0) await uploadAsset(scope, file, kind);
  }
  revalidatePath(`/w/${scope.tenantId}`, "layout");
}

/**
 * The same upload for client components, with a refusal returned as a message
 * they can show ("That SVG can't be used: it contains a script..."). A thrown
 * error's message never reaches the browser in production.
 */
export async function uploadAssetChecked(fd: FormData): Promise<{ error?: string }> {
  try {
    await uploadAssetAction(fd);
    return {};
  } catch (e) {
    if (e instanceof AssetError) return { error: e.message };
    throw e;
  }
}

/** Remove an upload (a logo, font or reference design). */
export async function deleteAssetAction(tenantId: string, assetId: string): Promise<void> {
  const scope = await actionScope(tenantId);
  await deleteAsset(scope, assetId);
  revalidatePath(`/w/${tenantId}`, "layout");
}

/** Intake: labelled notes → brief fields (only non-empty values overwrite). */
export async function submitIntakeAction(fd: FormData): Promise<void> {
  const { scope, base } = await ctx(fd);
  const text = String(fd.get("notes") ?? "");
  if (!text.trim()) redirect(`${base}/intake`);
  const parsed = parseIntake(text);
  await saveFoundation(scope, mergeIntake(await loadFoundation(scope), parsed));
  revalidatePath(`/w/${scope.tenantId}`, "layout");
  redirect(`${base}/questions?placed=${parsed.placedCount}`);
}

/**
 * Save the strategy questions (gap answers go INTO the brief; strategy answers
 * are kept as pillar seeds). With `generate`, the workspace's pillars are
 * generated from brief + seeds.
 */
export async function answerQuestionsAction(fd: FormData): Promise<void> {
  const { scope, base, back } = await ctx(fd);
  const foundation = await loadFoundation(scope);
  const questions = buildQuestions(foundation);
  const answers = Object.fromEntries(questions.map((q) => [q.key, String(fd.get(`q_${q.key}`) ?? "")]));
  const { foundation: next, seeds } = applyAnswers(foundation, questions, answers);
  await saveFoundation(scope, next);
  await saveBriefAnswers(scope, seeds);

  revalidatePath(`/w/${scope.tenantId}`, "layout");
  if (fd.get("intent") === "generate") {
    const context = await loadBrandContext(scope);
    if (context.degraded || seeds.length < MIN_SEEDS) redirect(`${base}/questions?blocked=1`);
    await generatePillars(scope);
    redirect(back ?? `${base}/pillars?generated=1`);
  }
  redirect(back ?? `${base}/questions?saved=1`);
}

/** The customer's hue: palette, fonts and image notes (step 3, Brand core › Visual). */
export async function saveVisualAction(tenantId: string, v: VisualIdentity): Promise<void> {
  await saveVisualIdentity(await actionScope(tenantId), v);
  revalidatePath(`/w/${tenantId}`, "layout");
}

/**
 * Read a brand off its own website (Obello-style onboarding): the home page
 * and up to three of its stylesheets, fetched on the server behind the SSRF
 * guard (lib/integrations/web), parsed in lib/visual/core. Nothing is saved
 * here: the person sees what was found and keeps what they want.
 */
export async function readSiteBrandAction(tenantId: string, url: string): Promise<{ ok: true; value: SiteBrand & { url: string } } | { ok: false; error: string }> {
  await actionScope(tenantId);
  try {
    const page = await safeGet(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
    const first = extractSiteBrand(page.body, [], page.url);
    const css = await Promise.all(first.stylesheets.map((s) => safeGet(s).then((r) => r.body).catch(() => "")));
    return { ok: true, value: { ...extractSiteBrand(page.body, css, page.url), url: page.url } };
  } catch {
    return { ok: false, error: "Couldn't read that site. Check the address, or set your hue by hand." };
  }
}
