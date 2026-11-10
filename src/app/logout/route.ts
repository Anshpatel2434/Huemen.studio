import { NextResponse } from "next/server";
import { signOut } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * `/logout` is the address people type when they want out, and it used to 404.
 * Signing out proper is the POST form in the account menu; this ends the
 * session too and lands on the same confirmation, so the guessed URL does the
 * expected thing rather than showing a dead end.
 *
 * GET only ends a session, which is the user's own; it exposes nothing and
 * changes nothing else.
 */
export async function GET(request: Request) {
  await signOut();
  return NextResponse.redirect(new URL("/signed-out", request.url));
}
