import { NextResponse } from "next/server";
import { limitByIp } from "@/lib/rate-limit";
import { PANTA_LIVE, PantaError, pantaFetch } from "@/lib/panta";
import { getDraft, PANTA_SANDBOX } from "@/lib/panta-market";
import { sessionWallet } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/markets/build { draftId } — step 2 of creating a market.
 *
 * Returns Panta's unsigned VersionedTransaction (base64) for the creator's
 * wallet to sign — it pays the creation fee. Panta's sandbox returns an empty
 * transaction: there is nothing to sign and nothing is charged.
 */
export async function POST(request: Request) {
  const limited = limitByIp(request, "panta-write", 30, 60_000);
  if (limited) return limited;
  if (!PANTA_LIVE) return NextResponse.json({ error: "Market creation needs a Panta API key on this server." }, { status: 503 });
  const wallet = sessionWallet(request);
  if (!wallet) return NextResponse.json({ error: "Sign in with X first.", needsAuth: true }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { draftId?: string };
  const draft = body.draftId ? await getDraft(body.draftId) : null;
  if (!draft) return NextResponse.json({ error: "That market draft expired — start again." }, { status: 410 });
  if (draft.wallet !== wallet) return NextResponse.json({ error: "This draft belongs to another wallet." }, { status: 403 });
  if (draft.marketId) return NextResponse.json({ error: "This market is already registered — host it with the existing draft." }, { status: 409 });
  if (draft.quoteExpiresAt && Date.parse(draft.quoteExpiresAt) <= Date.now() + 10_000) {
    return NextResponse.json({ code: "CREATE_EXPIRED", error: "Panta's quote expired. Check the creation fee again." }, { status: 410 });
  }

  try {
    const b = await pantaFetch<{ transaction?: string; expiresAt?: string }>(
      "/markets/create/build", { method: "POST", body: JSON.stringify({ createId: draft.createId, wallet }) }
    );
    if (!PANTA_SANDBOX && !b.transaction) return NextResponse.json({ error: "Panta returned no creation transaction. Nothing was signed or charged." }, { status: 502 });
    return NextResponse.json({ transaction: b.transaction ?? "", sandbox: !b.transaction, expiresAt: b.expiresAt ?? null });
  } catch (err) {
    console.error("panta /markets/create/build failed:", err);
    if (err instanceof PantaError) {
      try {
        const detail = JSON.parse(err.body) as { code?: string; error?: { code?: string } };
        const code = detail.code ?? detail.error?.code;
        if (code === "CREATE_EXPIRED") return NextResponse.json({ code, error: "Panta's quote expired. Check the creation fee again." }, { status: 410 });
      } catch { /* Panta returned non-JSON */ }
    }
    return NextResponse.json({ error: `Panta couldn't build the market transaction: ${(err instanceof Error ? err.message : "failed").slice(0, 160)}` }, { status: 502 });
  }
}
