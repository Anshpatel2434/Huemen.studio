import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Brand core fixes from the 2026-11-18 run (Harrow Lane Growth), checked in
 * the source: a place for stories and facts, the pillar map's opening zoom,
 * the style guide's Save in a tool strip, and real labels on fields.
 */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const BRAND = "src/app/w/[id]/brand";

describe("Brand core › Stories and facts", () => {
  it("is a Brand core tab", () => {
    expect(src(`${BRAND}/layout.tsx`)).toMatch(/href: `\$\{base\}\/stories`, label: "Stories and facts"/);
  });

  it("uses the same editors, and so the same server actions, as Getting started", () => {
    const page = src(`${BRAND}/stories/page.tsx`);
    const setup = src("src/app/w/[id]/setup/page.tsx");
    const editors = /import \{[^}]*ProofsEditor[^}]*StoriesEditor[^}]*\} from "\.\.\/(\.\.\/)?onboarding\/enrich-ui"/;
    expect(page).toMatch(editors);
    expect(setup).toMatch(editors);
    // Scoped the normal way, and no data path of its own.
    expect(page).toMatch(/workspaceScope\(id\)/);
    expect(page).not.toMatch(/"use server"|from "\.\/actions"|@\/lib\/db/);
    const ui = src("src/app/w/[id]/onboarding/enrich-ui.tsx");
    expect(ui).toMatch(/storiesAction\(tenantId, rows\)/);
    expect(ui).toMatch(/proofsAction\(tenantId, rows\)/);
  });
});

describe("Brand core › Pillars map", () => {
  it("opens on a readable frame, not the whole tree", () => {
    const map = src(`${BRAND}/pillars/pillar-map.tsx`);
    expect(map).toMatch(/data-artboard/);
    const span = Number(/const READABLE_SPAN = (\d+);/.exec(map)?.[1]);
    // The canvas fits the first artboard into its width less an 80px gutter
    // (components/canvas fit). ~540px of canvas on 1440x900 with both panels.
    const zoom = Math.min(1, (540 - 80) / span);
    expect(zoom).toBeGreaterThanOrEqual(0.7);
    expect(src("src/components/canvas.tsx")).toMatch(/querySelector<HTMLElement>\("\[data-artboard\]"\)/);
  });

  it("can edit a description with one click", () => {
    const map = src(`${BRAND}/pillars/pillar-map.tsx`);
    expect(map).toMatch(/aria-label=\{`Edit the description of \$\{p\.name\}`\}/);
    expect(map).toMatch(/editing=\{editingDesc\}/);
  });
});

describe("Brand core › Visual style guide", () => {
  const guide = src("src/components/style-guide.tsx");
  it("has no floating save pill", () => {
    expect(guide).not.toMatch(/sticky bottom-4/);
    expect(guide).not.toMatch(/rounded-full pl-5 pr-1\.5/);
  });
  it("keeps Save, the unsaved state and the shortcuts in the strip at the top", () => {
    const strip = guide.slice(guide.indexOf('<div className="sticky top-0'), guide.indexOf("<FontLoader fonts={fonts} />"));
    expect(strip).toMatch(/Save style guide/);
    expect(strip).toMatch(/Unsaved changes/);
    expect(strip).toMatch(/<Kbd>C<\/Kbd>[\s\S]*<Kbd>T<\/Kbd>[\s\S]*<Kbd>Space<\/Kbd>/);
    expect(guide).toMatch(/e\.key === "c" \|\| e\.key === "C"/);
    expect(guide).toMatch(/e\.code === "Space"/);
  });
});

/** Every id a label points at exists on a field in the same file. */
function labelsTied(file: string, ids: string[]) {
  const s = src(file);
  for (const id of ids) {
    expect(s, `label for ${id}`).toContain(`htmlFor="${id}"`);
    expect(s, `field ${id}`).toContain(`id="${id}"`);
  }
}

describe("labels, not placeholders, name the fields", () => {
  const guide = () => src("src/components/style-guide.tsx");
  it("Voice › In your words", () => {
    labelsTied(`${BRAND}/voice/page.tsx`, ["voice-line", "voice-reader", "voice-carries", "voice-hard-rules", "voice-never-words"]);
  });
  it("Brief questions", () => {
    const s = src(`${BRAND}/questions/page.tsx`);
    expect(s).toMatch(/<label htmlFor=\{`q-\$\{q\.key\}`\}/);
    expect(s.match(/id=\{`q-\$\{q\.key\}`\}/g)?.length).toBe(2); // the input and the textarea
  });
  it("Visual › notes, photo style, layout, motifs", () => {
    expect(guide()).toMatch(/<label htmlFor=\{id\} className="hu-label/);
    expect(guide()).toMatch(/<textarea id=\{id\}/);
  });
});
