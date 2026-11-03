/**
 * Pre-workshop questionnaire links (brief §4.1).
 *
 * The link is mailed around before a workshop and gets forwarded, so it has to
 * do two things: write only ever to the one workspace it names (INV-1), and
 * stop working. It previously had no expiry at all, while the form it opens
 * says "invalid or expired" — so the message was a promise the token could not
 * keep.
 */
import "dotenv/config";
import { describe, it, expect } from "vitest";
import {
  signQuestionnaireToken,
  verifyQuestionnaireToken,
  QUESTIONNAIRE_TTL_SECONDS,
} from "@/lib/invite/token";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const DAY = 24 * 60 * 60 * 1000;

describe("a questionnaire link", () => {
  it("opens the workspace it was minted for", () => {
    expect(verifyQuestionnaireToken(signQuestionnaireToken(A))).toBe(A);
  });

  it("never opens a different workspace", () => {
    const forA = signQuestionnaireToken(A);
    const forB = signQuestionnaireToken(B);
    expect(verifyQuestionnaireToken(forA)).not.toBe(B);
    expect(verifyQuestionnaireToken(forB)).not.toBe(A);
    // Swapping the tenant id in a valid link breaks the signature.
    const swapped = forA.replace(A, B);
    expect(verifyQuestionnaireToken(swapped)).toBeNull();
  });

  it("stops working once it is old", () => {
    const now = Date.now();
    const token = signQuestionnaireToken(A, now);
    expect(verifyQuestionnaireToken(token, now + DAY)).toBe(A);
    expect(verifyQuestionnaireToken(token, now + QUESTIONNAIRE_TTL_SECONDS * 1000 + 1)).toBeNull();
  });

  it("refuses a link with no expiry, which is the shape that used to last for ever", () => {
    expect(verifyQuestionnaireToken(`${A}.deadbeef`)).toBeNull();
  });

  it("refuses a tampered expiry", () => {
    const token = signQuestionnaireToken(A);
    const [tenant, exp, sig] = token.split(".");
    const later = String(Number(exp) + 10 * 365 * 24 * 60 * 60);
    expect(verifyQuestionnaireToken(`${tenant}.${later}.${sig}`)).toBeNull();
  });

  it("refuses rubbish without throwing", () => {
    for (const bad of ["", ".", "nope", `${A}.`, `.${A}`]) {
      expect(verifyQuestionnaireToken(bad)).toBeNull();
    }
  });
});
