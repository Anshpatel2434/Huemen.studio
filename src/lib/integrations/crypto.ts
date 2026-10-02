/**
 * Sealing provider tokens at rest (AES-256-GCM).
 *
 * The key lives in the environment (CONNECTIONS_KEY, 32 random bytes in
 * base64), never in the repo or the database, so a dump of the database alone
 * cannot be used to read anyone's mail. Each value gets its own random IV and
 * an auth tag, so a tampered value fails to open instead of decrypting to junk.
 *
 * Format: "v1.<iv>.<tag>.<ciphertext>", each part base64url.
 *
 * Server-only.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AiConfigError } from "@/lib/ai/errors";

export class ConnectionsConfigError extends AiConfigError {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionsConfigError";
  }
}

function keyFrom(b64: string | undefined): Buffer {
  if (!b64) throw new ConnectionsConfigError("CONNECTIONS_KEY is not set. Generate 32 random bytes, base64, and add it to .env.");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new ConnectionsConfigError("CONNECTIONS_KEY must be 32 bytes, base64-encoded.");
  return key;
}

const b64u = (b: Buffer) => b.toString("base64url");

export function seal(plain: string, keyB64: string | undefined): string {
  const key = keyFrom(keyB64);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", b64u(iv), b64u(cipher.getAuthTag()), b64u(ct)].join(".");
}

export function open(sealed: string, keyB64: string | undefined): string {
  const key = keyFrom(keyB64);
  const [v, iv, tag, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Sealed value is not in a known format.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}
