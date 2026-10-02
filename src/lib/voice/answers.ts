/**
 * Where each answer goes. Pure: (pack, question, answer) → patch.
 *
 * Every question in lib/voice/questions names what it `fills`; this is the
 * only code that turns that name into a change to the pack. Two rules from the
 * spec (file 01 §4) are applied here and nowhere else:
 *
 *   - Claimed beats observed for guardrails and aspiration: what a person says
 *     they will never write is a rule, whatever their old posts did.
 *   - Observed beats claimed for mechanics: a typed answer never overwrites a
 *     MEASURED value. It is added beside it, or ignored.
 */
import { questionById } from "./questions";
import {
  tagged,
  type DialKey,
  type Guardrail,
  type PersonalityWord,
  type VoicePack,
} from "./types";
import type { PackPatch } from "@/lib/data/voice-pack";

export type Answer = string | string[] | Record<string, string>;

export interface AnswerOutcome {
  patch: PackPatch;
  /** Spoken answers are also writing samples (file 05, Part 1, rule 3). */
  spokenSample?: string;
}

const text = (a: Answer): string =>
  typeof a === "string" ? a.trim() : Array.isArray(a) ? a.join(", ") : Object.values(a).join("\n");
const list = (a: Answer): string[] =>
  (Array.isArray(a) ? a : typeof a === "string" ? a.split(",") : Object.values(a))
    .map((x) => x.trim())
    .filter(Boolean);

function guardrail(pack: VoicePack, id: string, name: string, rule: string, why = "", instead = ""): Guardrail[] {
  const others = pack.guardrails.filter((g) => g.id !== id);
  return rule ? [...others, { id, name, rule, why, instead, source: "ask" }] : others;
}

export function applyAnswer(pack: VoicePack, questionId: string, answer: Answer): AnswerOutcome {
  const q = questionById(questionId);
  if (!q) throw new Error(`Unknown question ${questionId}`);
  const id = pack.identity;
  const value = text(answer);
  const spokenSample = q.spoken && value.split(/\s+/).length >= 15 ? value : undefined;

  switch (q.fills) {
    case "identity.reader":
      return { patch: { identity: { ...id, reader: tagged(value, "ask") } } };
    case "identity.personaRoles":
      return { patch: { identity: { ...id, personaRoles: tagged(list(answer), "ask") } } };
    case "identity.carries":
      return { patch: { identity: { ...id, carries: tagged(value, "ask") } } };
    case "identity.voiceParagraph":
      return { patch: { identity: { ...id, voiceParagraph: tagged(value, "ask") } } };
    case "identity.roots":
      return { patch: { identity: { ...id, roots: tagged(value, "ask") } }, spokenSample };
    case "identity.guarded":
      return { patch: { identity: { ...id, guarded: tagged(value, "ask") } }, spokenSample };
    case "identity.unguarded":
      return { patch: { identity: { ...id, unguarded: tagged(value, "ask") } }, spokenSample };
    case "identity.humour":
      return { patch: { identity: { ...id, humour: tagged(value, "ask") } } };
    case "identity.language":
      return { patch: { identity: { ...id, language: tagged(value, "ask") } } };
    case "identity.personalityLonglist":
      return { patch: { identity: { ...id, personalityLonglist: tagged(list(answer), "ask") } } };
    case "identity.personalityWords": {
      const words: PersonalityWord[] = list(answer).slice(0, 4).map((word) => ({
        word,
        meaning: id.personalityWords?.value?.find((w) => w.word === word)?.meaning ?? "",
      }));
      return { patch: { identity: { ...id, personalityWords: tagged(words, "ask") } } };
    }
    case "identity.personalityMeanings": {
      const meanings = typeof answer === "object" && !Array.isArray(answer) ? answer : {};
      const words = (id.personalityWords?.value ?? []).map((w) => ({ ...w, meaning: meanings[w.word]?.trim() || w.meaning }));
      return { patch: { identity: { ...id, personalityWords: tagged(words, "ask") } } };
    }
    case "identity.feelings": {
      const v = typeof answer === "object" && !Array.isArray(answer) ? Object.values(answer) : [value];
      return {
        patch: {
          identity: {
            ...id,
            feeling30s: v[0] ? tagged(v[0].trim(), "ask") : id.feeling30s,
            feeling5m: v[1] ? tagged(v[1].trim(), "ask") : id.feeling5m,
            feeling20m: v[2] ? tagged(v[2].trim(), "ask") : id.feeling20m,
          },
        },
      };
    }
    case "identity.answers": {
      const extra = typeof answer === "object" && !Array.isArray(answer)
        ? Object.fromEntries(Object.entries(answer).map(([k, v]) => [`${q.id} · ${k}`, v]))
        : { [q.id]: value };
      return { patch: { identity: { ...id, answers: { ...(id.answers ?? {}), ...extra } } } };
    }
    case "contexts.situations":
    case "contexts.signoffs": {
      const extra = typeof answer === "object" && !Array.isArray(answer)
        ? Object.fromEntries(Object.entries(answer).filter(([, v]) => v.trim()).map(([k, v]) => [`${q.id} · ${k}`, v.trim()]))
        : { [q.id]: value };
      return { patch: { identity: { ...id, answers: { ...(id.answers ?? {}), ...extra } } } };
    }

    // Guardrails: claimed beats observed (file 01 §4).
    case "guardrails.selfLabel":
      return { patch: { guardrails: guardrail(pack, "self-label", "Self-labelling", value, "", "Show the work and let the reader conclude it.") } };
    case "guardrails.offLimits":
      return { patch: { guardrails: guardrail(pack, "off-limits", "Off-limits", value) } };
    case "guardrails.never":
      return { patch: { guardrails: guardrail(pack, "never-write", "Never written", value) } };
    case "guardrails.against":
      return { patch: { guardrails: guardrail(pack, "against", "The style they're against", value, "It's what drives them mad in their field.") } };
    case "guardrails.stance":
      return { patch: { guardrails: guardrail(pack, "stance", "Stance", value) } };
    case "guardrails.toneMix":
      return { patch: { guardrails: guardrail(pack, "tone-mix", "Mix of stories", value) } };

    case "redPen.neverList":
    case "redPen.pushy": {
      const add = list(answer).map((w) => w.toLowerCase());
      const never = [...new Set([...pack.index.neverWords.map((w) => w.toLowerCase()), ...add])];
      return {
        patch: {
          redPen: { ...pack.redPen, neverList: tagged(never, "ask") },
          index: { ...pack.index, neverWords: never },
        },
      };
    }

    // Mechanics: observed beats claimed. Typed words join a measured lexicon;
    // they never replace it.
    case "mechanics.lexicon": {
      const cur = pack.mechanics.lexicon;
      const merged = [...new Set([...(cur?.value ?? []), ...list(answer).map((w) => w.toLowerCase())])];
      return { patch: { mechanics: { ...pack.mechanics, lexicon: cur ? { ...cur, value: merged } : tagged(merged, "ask") } } };
    }
    case "mechanics.signature": {
      const phrase = value.replace(/^.+?→\s*/, "").trim();
      if (!phrase) return { patch: {} };
      const sigs = [...new Set([...pack.index.signaturePhrases, phrase.toLowerCase()])];
      return { patch: { index: { ...pack.index, signaturePhrases: sigs } } };
    }
    case "mechanics.opener": {
      const cur = pack.mechanics.openers;
      const openers = [{ pattern: "Their own pick", example: value }, ...(cur?.value ?? [])];
      return { patch: { mechanics: { ...pack.mechanics, openers: cur ? { ...cur, value: openers } : tagged(openers, "ask") } } };
    }
  }
  throw new Error(`Question ${q.id} fills "${q.fills}", which has no writer.`);
}

/**
 * Saving the dials (C4). The scan's estimate is kept as `measuredValue`, so a
 * dial moved 3+ points raises an H1 card asking which one to write like.
 */
export function applyDials(
  pack: VoicePack,
  dials: Partial<Record<DialKey, number>>,
  estimated: Partial<Record<DialKey, number>>,
): PackPatch {
  const clean = Object.fromEntries(
    Object.entries(dials).filter(([, v]) => typeof v === "number" && v >= 1 && v <= 10),
  ) as Partial<Record<DialKey, number>>;
  return {
    identity: {
      ...pack.identity,
      dials: { ...tagged(clean, "ask"), ...(Object.keys(estimated).length ? { measuredValue: estimated } : {}) },
    },
    index: { ...pack.index, dials: clean },
  };
}
