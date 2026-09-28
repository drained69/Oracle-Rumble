import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieValue, verifyChallenge } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/verify { wallet, message, token, signature(base64) }
 * Checks the wallet's signature over its challenge and starts a session.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { wallet?: string; message?: string; token?: string; signature?: string };
  const res = verifyChallenge({
    wallet: body.wallet ?? "",
    message: body.message ?? "",
    token: body.token ?? "",
    signature: body.signature ?? ""
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 401 });
  const { value, maxAge } = sessionCookieValue(body.wallet!);
  const out = NextResponse.json({ ok: true, wallet: body.wallet });
  out.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge
  });
  return out;
}
