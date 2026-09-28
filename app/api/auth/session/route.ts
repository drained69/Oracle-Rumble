import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionWallet } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET /api/auth/session → { wallet } the browser is signed in as (or null). */
export async function GET(request: Request) {
  return NextResponse.json({ wallet: sessionWallet(request) });
}

/** DELETE /api/auth/session → sign out. */
export async function DELETE() {
  const out = NextResponse.json({ ok: true });
  out.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return out;
}
