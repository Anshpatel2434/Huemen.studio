/**
 * Passwords for AUTH_PASSWORD_SIGNIN (migration 0028): scrypt with a random
 * salt per password, stored as "scrypt$N$salt$hash" (both base64url), compared
 * in constant time. No dependency beyond node:crypto.
 *
 * Used by the sign-in pages and by scripts/set-password.ts, so it does not
 * use the `server-only` guard; it must never be imported by client code.
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 16384;
const KEY_BYTES = 32;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

function derive(password: string, salt: Buffer, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEY_BYTES, { N: n, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Why a chosen password is refused, in plain words; null when it is fine. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (/^(.)\1+$/.test(password)) return "Use more than one repeated character.";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N);
  return `scrypt$${N}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/** True only for the password the hash was made from. Never throws on a malformed hash. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const [kind, n, salt, hash] = (stored ?? "").split("$");
  const cost = Number(n);
  if (kind !== "scrypt" || !salt || !hash || !Number.isInteger(cost) || cost < 1024 || cost > 1 << 20) {
    // Spend the same time as a real check, so a missing password can't be told from a wrong one.
    await derive(password, Buffer.alloc(16), N);
    return false;
  }
  const want = Buffer.from(hash, "base64url");
  const got = await derive(password, Buffer.from(salt, "base64url"), cost);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** A password to hand to someone: 20 characters, no look-alikes. */
export function generatePassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  while (out.length < 20) {
    for (const b of randomBytes(32)) {
      // 224 = 4 x 56 letters: bytes above it would skew the pick.
      if (b >= 224 || out.length >= 20) continue;
      out += alphabet[b % alphabet.length];
    }
  }
  return out;
}
