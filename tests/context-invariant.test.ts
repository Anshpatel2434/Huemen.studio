/**
 * INV-2 guard: brand and voice data reach a model only through the one context
 * builder. No data module may write it into a task input itself.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildBrandContext } from "@/lib/context/context-builder";

const DIRS = [join(__dirname, "..", "src", "lib", "data"), join(__dirname, "..", "src", "app")];
const FORBIDDEN = [
  /`Never use: /, /Strategy answers:/, /p\.description \? ` \(/,
  // Brief fields written into a task input by hand (they are in the block).
  /`(Niche|Audience|Positioning|Offers|Story|About): \$\{(f|foundation|bp|brief)\./,
];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

describe("INV-2: one context builder", () => {
  it("no data module or page writes brand data (never-words, strategy answers, pillar descriptions, brief fields) into a task input", () => {
    const offenders = DIRS.flatMap(files)
      .flatMap((f) => FORBIDDEN.filter((re) => re.test(readFileSync(f, "utf8"))).map((re) => `${f}: ${re}`));
    expect(offenders).toEqual([]);
  });
  it("pillars and strategy answers are in the block instead", () => {
    const ctx = buildBrandContext({
      brandProfile: { pillars: [{ name: "Systems", description: "How the work runs" }], strategyAnswers: [{ key: "known_for", answer: "Clarity" }] },
    });
    expect(ctx.serialized).toContain("  - Systems: How the work runs");
    expect(ctx.serialized).toContain("known_for: Clarity");
  });
  it("offers carry what is in them and how they are priced (context v7)", () => {
    const ctx = buildBrandContext({
      brandProfile: { offers: [{ name: "First 90 Days", format: "6-week cohort", promise: "Lead without losing the team", deliverables: ["Weekly call", "Playbook"], pricing: "Anchored to one hire saved" }] },
    });
    expect(ctx.serialized).toContain("  - First 90 Days: 6-week cohort. Lead without losing the team");
    expect(ctx.serialized).toContain("    Includes: Weekly call; Playbook");
    expect(ctx.serialized).toContain("    Priced: Anchored to one hire saved");
  });
});
