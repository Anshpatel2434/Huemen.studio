/** Carousel frames only for the formats that are carousels (formatUsesCarousel). */
import { describe, it, expect } from "vitest";
import { FORMATS, formatUsesCarousel } from "@/lib/content/formats";

describe("formatUsesCarousel", () => {
  it("is on for the carousel formats only: an Instagram carousel and a LinkedIn post", () => {
    const on = FORMATS.filter((f) => formatUsesCarousel(f.key)).map((f) => f.key).sort();
    expect(on).toEqual(["ig_carousel", "linkedin_post"]);
  });

  it("is off for the short formats that were getting six frames by mistake", () => {
    for (const key of ["x_post", "whatsapp_message", "linkedin_comment", "threads_post", "slack_message", "bio", "hook_set", "ig_caption"]) {
      expect(formatUsesCarousel(key), key).toBe(false);
    }
  });

  it("is off for an unknown or missing format (not the first format's default)", () => {
    expect(formatUsesCarousel("not_a_format")).toBe(false);
    expect(formatUsesCarousel(null)).toBe(false);
    expect(formatUsesCarousel(undefined)).toBe(false);
  });
});
