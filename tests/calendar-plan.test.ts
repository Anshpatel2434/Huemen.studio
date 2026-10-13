import { describe, expect, it } from "vitest";
import { planSlots, CALENDAR_DAYS } from "@/lib/content/calendar-plan";
import { calendarPlan } from "@/lib/ai/tasks";

describe("planSlots (the 90-day skeleton)", () => {
  it("three a week lands on Mon, Wed and Fri for the whole window", () => {
    const slots = planSlots({ start: "2026-10-13", perWeek: 3, channels: ["linkedin"] }); // a Tuesday
    expect(slots[0].date).toBe("2026-10-14"); // Wed
    expect(slots[1].date).toBe("2026-10-16"); // Fri
    expect(slots[2].date).toBe("2026-10-19"); // Mon
    const last = slots[slots.length - 1].date;
    expect(last <= "2027-01-10").toBe(true); // start + 89 days
    expect(slots.length).toBeGreaterThanOrEqual(38);
    expect(slots.length).toBeLessThanOrEqual(39);
    for (const s of slots) expect([1, 3, 5]).toContain(new Date(`${s.date}T00:00:00Z`).getUTCDay());
  });

  it("numbers slots from 1 and takes channels in turn", () => {
    const slots = planSlots({ start: "2026-10-12", perWeek: 2, channels: ["linkedin", "newsletter"], days: 14 });
    expect(slots.map((s) => s.slot)).toEqual([1, 2, 3, 4]);
    expect(slots.map((s) => s.channel)).toEqual(["linkedin", "newsletter", "linkedin", "newsletter"]);
    expect(slots[0].label).toBe("Tue 13 Oct");
  });

  it("leaves days that already hold a slot alone and still counts from 1", () => {
    const slots = planSlots({ start: "2026-10-12", perWeek: 5, channels: ["x"], days: 7, skip: new Set(["2026-10-13", "2026-10-15"]) });
    expect(slots.map((s) => s.date)).toEqual(["2026-10-12", "2026-10-14", "2026-10-16"]);
    expect(slots.map((s) => s.slot)).toEqual([1, 2, 3]);
  });

  it("clamps cadence and never plans past the window", () => {
    expect(planSlots({ start: "2026-01-01", perWeek: 99, channels: ["linkedin"] }).length).toBe(CALENDAR_DAYS);
    expect(planSlots({ start: "2026-01-01", perWeek: 0, channels: [] }).every((s) => s.channel === "linkedin")).toBe(true);
  });
});

describe("calendar_plan stand-in", () => {
  it("fills every slot it is given, rotating the pillars", () => {
    const input = ["Pillar: Delegation (letting go)", "Pillar: Hiring", "Slot: 1 | Mon 13 Oct | linkedin", "Slot: 2 | Wed 15 Oct | newsletter", "Slot: 3 | Fri 17 Oct | linkedin"].join("\n");
    const out = calendarPlan.schema.parse(calendarPlan.mock(input));
    expect(out.slots.map((s) => s.slot)).toEqual([1, 2, 3]);
    expect(out.slots.map((s) => s.pillar)).toEqual(["Delegation", "Hiring", "Delegation"]);
    expect(out.slots[0].topic).toMatch(/delegation/);
    expect(out.slots[0].hookAngle).not.toBe(out.slots[1].hookAngle);
  });
});
