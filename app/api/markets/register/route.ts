import { NextResponse } from "next/server";
import { limitByIp } from "@/lib/rate-limit";
import { PANTA_LIVE, pantaFetch } from "@/lib/panta";
import { getDraft, markDraftRegistered, PANTA_SANDBOX } from "@/lib/panta-market";
import { sessionWallet } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Panta's sandbox accepts this in place of a real signature (no transaction exists). */
const SANDBOX_SIGNATURE = "sandboxSignature" + "1".repeat(43);

/**
 * POST /api/markets/register { draftId, signature } — step 3 of creating a
 * market. Panta checks the signature on chain and lists the market. The
 * draft keeps the creator's exact question (Panta's sandbox answers with its
 * fixture's title instead); the market id is what the pit trades and settles on.
 */
export async function POST(request: Request) {
  const limited = limitByIp(request, "panta-write", 30, 60_000);
  if (limited) return limited;
  if (!PANTA_LIVE) return NextResponse.json({ error: "Market creation needs a Panta API key on this server." }, { status: 503 });
  const wallet = sessionWallet(request);
  if (!wallet) return NextResponse.json({ error: "Sign in with X first.", needsAuth: true }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { draftId?: string; signature?: string };
  const draft = body.draftId ? await getDraft(body.draftId) : null;
  if (!draft) return NextResponse.json({ error: "That market draft expired — start again." }, { status: 410 });
  if (draft.wallet !== wallet) return NextResponse.json({ error: "This draft belongs to another wallet." }, { status: 403 });
  if (draft.marketId) return NextResponse.json({ marketId: draft.marketId, draftId: draft.draftId, sandbox: PANTA_SANDBOX });

  const signature = PANTA_SANDBOX ? SANDBOX_SIGNATURE : (body.signature ?? "");
  if (!PANTA_SANDBOX && !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) {
    return NextResponse.json({ error: "Missing the signed creation transaction." }, { status: 400 });
  }
  try {
    const r = await pantaFetch<{ marketId?: string; status?: string }>(
      "/markets/register", { method: "POST", body: JSON.stringify({ createId: draft.createId, signature }) }
    );
    if (!r.marketId) return NextResponse.json({ error: "Panta didn't return a market id — try registering again." }, { status: 502 });
    await markDraftRegistered(draft.draftId, r.marketId, signature);
    return NextResponse.json({ marketId: r.marketId, draftId: draft.draftId, status: r.status ?? "registered", sandbox: PANTA_SANDBOX });
  } catch (err) {
    console.error("panta /markets/register failed:", err);
    return NextResponse.json({ error: `Panta couldn't register the market: ${(err instanceof Error ? err.message : "failed").slice(0, 160)}` }, { status: 502 });
  }
}
