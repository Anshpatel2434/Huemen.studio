/**
 * Audit M2 (2026-11-18): the calendar plan carries the facts and ask rules, and
 * a slot the model leaves out is reported as omitted, not as planned or skipped.
 * The database and the model are stubs; the slot skeleton is the real planSlots.
 */
import { describe, it, expect, vi } from "vitest";

const st = vi.hoisted(() => ({ keep: 3, seen: [] as string[] }));

vi.mock("@/db/session", () => ({
  withTenantSession: async (_scope: unknown, fn: (c: unknown) => unknown) =>
    fn({ query: async () => ({ rows: [], rowCount: 0 }) }),
}));
vi.mock("@/lib/ai", () => ({
  runTask: async (_scope: unknown, _task: unknown, input: { taskInput: string }) => {
    // The model answers only the first few slots it is given, and leaves the rest out.
    const slots = input.taskInput
      .split("\n")
      .filter((l) => l.startsWith("Slot: "))
      .map((l) => Number(l.slice(6).split("|")[0]));
    st.seen = slots.map(String);
    return {
      slots: slots.slice(0, st.keep).map((slot) => ({ slot, pillar: "", topic: "A topic", hookAngle: "A hook", cta: "" })),
    };
  },
}));
vi.mock("@/lib/context/context-loader", () => ({ loadBrandContext: async () => ({}) }));

import { generateCalendar } from "@/lib/data/planning";
import { calendarPlan } from "@/lib/ai/tasks";
import { planSlots } from "@/lib/content/calendar-plan";
import type { WorkspaceScope } from "@/lib/data/projects";

const scope = { tenantId: "22222222-2222-4222-8222-222222222222", userId: null, isPlatformAdmin: false } as unknown as WorkspaceScope;
const opts = { start: "2026-12-01", perWeek: 3, channels: ["linkedin_post"] };

describe("the calendar plan's rules (M2)", () => {
  it("carries the facts and ask rules, like a draft does", () => {
    expect(calendarPlan.rules).toEqual(["facts", "ask"]);
  });
});

describe("generateCalendar counts every slot once (M2)", () => {
  it("reports the slots the model left out separately from planned and skipped", async () => {
    st.keep = 3;
    const total = planSlots({ ...opts }).length;
    expect(total).toBeGreaterThan(3);
    const out = await generateCalendar(scope, opts);
    expect(out.planned).toBe(3);
    expect(out.skipped).toBe(0);
    expect(out.omitted).toBe(total - 3);
    expect(out.planned + out.skipped + out.omitted).toBe(total);
  });

  it("reports no omitted slots when the model fills every one", async () => {
    const total = planSlots({ ...opts }).length;
    st.keep = total;
    const out = await generateCalendar(scope, opts);
    expect(out).toEqual({ planned: total, skipped: 0, omitted: 0 });
  });
});
