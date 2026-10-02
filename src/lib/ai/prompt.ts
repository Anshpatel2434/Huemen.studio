/**
 * Prompt assembly (INV-2, brief §05). Pure — no I/O, no clock.
 *
 * Every prompt is: system template + brand context block + task input. This is
 * the ONE place that order is applied, and every provider receives the result.
 *
 * Two splits matter here, and both are deliberate:
 *
 *   system  = the template and the brand context. Stable for a workspace and a
 *             format, so a provider can cache it. Nothing in it may vary per
 *             request (no timestamps, no ids), or every call pays for it again.
 *   user    = the task and the output contract. Changes every call.
 *
 * The OUTPUT CONTRACT is code-owned on purpose. Templates are data an admin can
 * edit (brief §05); the parsers that read the model's reply are code. If the
 * shape the parser needs lived in the editable template, one well-meant edit
 * would silently break every draft. So the template says how to write, and the
 * contract — appended here, not editable — says what shape to hand back.
 */
import type { BrandContext } from "@/lib/context/context-builder";

export interface AssembledPrompt {
  system: string;
  user: string;
}

/**
 * What each template's reply must look like, matched to the code that parses
 * it. `variants` is how many distinct versions to write; the provider returns
 * them as separate strings, and each string must satisfy the contract alone.
 */
function contractFor(templateKey: string, variants: number): string {
  if (templateKey === "pillar_set") {
    // Read by parsePillarLines (lib/data/pipeline).
    return [
      "Return exactly one variant.",
      "Write each pillar on its own line as: Name :: one-line description",
      "No numbering, no headings, no other text.",
    ].join("\n");
  }
  // Every content format is read by splitDraft (lib/content/formats): the first
  // line is the hook, the last line is the call to action, the rest is body.
  return [
    `Write ${variants} distinct ${variants === 1 ? "version" : "versions"}. Make them genuinely different in angle or opening, not rewordings of one another.`,
    "Each version is a complete piece on its own:",
    "- The first line is the hook.",
    "- Then the body.",
    '- The last line is the call to action, starting with "CTA: ". Leave it out only if the format has no ask.',
    "Write in the person's voice as described in the brand context. Never copy a sentence from their samples.",
    "Never invent a fact, name, number, client or credential. Where one is needed and not in the brand context, write [placeholder] and keep going.",
  ].join("\n");
}

export function assemblePrompt(
  systemTemplate: string,
  context: BrandContext,
  taskInput: string,
  opts: { templateKey: string; variants?: number; contract?: string },
): AssembledPrompt {
  const system = [
    systemTemplate.trim(),
    "",
    "<brand_context>",
    context.serialized,
    "</brand_context>",
  ].join("\n");

  const user = [
    "<task>",
    taskInput.trim(),
    "</task>",
    "",
    "<output>",
    opts.contract ?? contractFor(opts.templateKey, Math.max(1, opts.variants ?? 1)),
    "</output>",
  ].join("\n");

  return { system, user };
}
