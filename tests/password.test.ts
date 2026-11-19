import { describe, expect, it } from "vitest";
import { generatePassword, hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";

describe("passwords (AUTH_PASSWORD_SIGNIN)", () => {
  it("verifies only the password the hash was made from", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterx", hash)).toBe(false);
  });
  it("salts every hash", async () => {
    expect(await hashPassword("same password 1")).not.toBe(await hashPassword("same password 1"));
  });
  it("refuses a missing or malformed hash without throwing", async () => {
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(await verifyPassword("anything", "")).toBe(false);
    expect(await verifyPassword("anything", "scrypt$1$x$y")).toBe(false);
    expect(await verifyPassword("anything", "plain-text")).toBe(false);
  });
  it("says why a chosen password is refused", () => {
    expect(passwordProblem("short")).toMatch(/at least/);
    expect(passwordProblem("aaaaaaaaaaaa")).toBeTruthy();
    expect(passwordProblem("a perfectly fine one")).toBeNull();
  });
  it("generates 20-character passwords that pass its own rule", () => {
    const a = generatePassword(), b = generatePassword();
    expect(a).toHaveLength(20);
    expect(a).not.toBe(b);
    expect(passwordProblem(a)).toBeNull();
  });
});
