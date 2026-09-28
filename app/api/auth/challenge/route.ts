import { NextResponse } from "next/server";
import { issueChallenge } from "@/lib/session";

export const dynamic = "force-dynamic";

/** POST /api/auth/challenge { wallet } → { message, token } for the wallet to sign. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { wallet?: string };
  const ch = issueChallenge(body.wallet ?? "");
  if (!ch) return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  return NextResponse.json(ch);
}
