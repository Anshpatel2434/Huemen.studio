/**
 * INV-2 guard: brand and voice data reach a model only through the one context
 * builder. No data module may write it into a task input itself.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildBrandContext } from "@/lib/context/context-builder";

const DIR = join(__dirname, "..", "src", "lib", "data");
const FORBIDDEN = [/`Never use: /, /Strategy answers:/, /p\.description \? ` \(/];

describe("INV-2: one context builder", () => {
  it("no data module appends never-words, strategy answers or pillar descriptions to a task input", () => {
    const offenders = readdirSync(DIR)
      .filter((f) => f.endsWith(".ts"))
      .flatMap((f) => FORBIDDEN.filter((re) => re.test(readFileSync(join(DIR, f), "utf8"))).map((re) => `${f}: ${re}`));
    expect(offenders).toEqual([]);
  });
  it("pillars and strategy answers are in the block instead", () => {
    const ctx = buildBrandContext({
      brandProfile: { pillars: [{ name: "Systems", description: "How the work runs" }], strategyAnswers: [{ key: "known_for", answer: "Clarity" }] },
    });
    expect(ctx.serialized).toContain("  - Systems: How the work runs");
    expect(ctx.serialized).toContain("known_for: Clarity");
  });
});
