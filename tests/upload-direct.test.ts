/**
 * Direct uploads (lib/storage/upload): a file goes to storage first, under the
 * workspace's incoming/ prefix, and the step that uses it takes it back out.
 * Write tokens are for one key and one size; a workspace can only take its own
 * incoming files; a taken file is gone; oversize uploads never get a target.
 */
import "dotenv/config";
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { storage } from "@/lib/storage";
import { incomingKey, isIncomingKey, signPut, takeIncoming, uploadTarget, verifyPut, UPLOAD_LIMITS } from "@/lib/storage/upload";

const A = randomUUID();
const B = randomUUID();

describe("direct uploads", () => {
  it("names incoming files under the workspace, with a safe tail", () => {
    const key = incomingKey(A, "../../My Logo (Final).PNG");
    expect(key.startsWith(`tenants/${A}/incoming/`)).toBe(true);
    expect(key).toMatch(/-my-logo-final-\.png$|-my-logo-final-.png$/);
    expect(key).not.toContain("..");
    expect(isIncomingKey(key, A)).toBe(true);
    expect(isIncomingKey(key, B)).toBe(false);
    expect(isIncomingKey(`tenants/${A}/assets/x.png`, A)).toBe(false);
  });

  it("signs a write for one key and one size only", () => {
    const key = incomingKey(A, "a.pdf");
    const token = signPut(key, 1234);
    expect(verifyPut(key, token)).toBe(1234);
    expect(verifyPut(incomingKey(A, "b.pdf"), token)).toBeNull();
    const [exp, , mac] = token.split(".");
    expect(verifyPut(key, `${exp}.9999999.${mac}`)).toBeNull();
    expect(verifyPut(key, `${Date.now() - 1}.1234.${mac}`)).toBeNull();
  });

  it("refuses a target for a file over the limit, and points small local uploads at the relay", async () => {
    await expect(uploadTarget(A, "asset", "big.png", UPLOAD_LIMITS.asset + 1, "image/png")).rejects.toThrow(/over 5 MB/);
    const t = await uploadTarget(A, "document", "notes.pdf", 2048, "application/pdf");
    expect(isIncomingKey(t.key, A)).toBe(true);
    expect(t.url).toContain(`/api/storage/tenants/${A}/incoming/`);
    expect(verifyPut(t.key, new URL(t.url).searchParams.get("put")!)).toBe(2048);
    expect(t.headers["Content-Type"]).toBe("application/pdf");
  });

  it("hands the bytes back once, to the workspace that uploaded them", async () => {
    const key = incomingKey(A, "doc.pdf");
    await storage().put(key, new Uint8Array([37, 80, 68, 70]), "application/octet-stream");
    expect(await takeIncoming(B, key, "document")).toBeNull();
    expect(await takeIncoming(A, `tenants/${A}/assets/other.png`, "document")).toBeNull();
    expect([...(await takeIncoming(A, key, "document"))!]).toEqual([37, 80, 68, 70]);
    expect(await takeIncoming(A, key, "document")).toBeNull();
    expect(await storage().get(key)).toBeNull();
  });
});
