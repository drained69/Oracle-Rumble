import { NextResponse } from "next/server";
import { limitByIp, overLimit } from "@/lib/rate-limit";
import { PANTA_LIVE, pantaFetch } from "@/lib/panta";
import { PANTA_CATEGORIES, PANTA_SANDBOX, saveDraft, type PantaCategory } from "@/lib/panta-market";
import { STORE_ENABLED } from "@/lib/round-store";
import { sessionWallet } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/markets/quote — step 1 of creating a Panta market for a pit.
 *
 * Body: { question, category, resolutionRule, sourcesOfTruth[], endsAt (unix s), breaking }
 *
 * The creator is the signed-in wallet (never a body field). The server sets
 * Panta's timing rules: a "breaking" market (an event already under way, e.g.
 * tonight's game) starts trading now; a standard market must start at least
 * Panta's on-chain minimum delay (~1h) ahead. Returns a `draftId` the rest of
 * the flow (build → sign → register → host) carries, plus the creation fee
 * exactly as Panta quoted it.
 */
const MIN_START_DELAY_SEC = 3_600 + 120; // Panta's minimumStartDelay + margin
const RESOLVE_AFTER_SEC = 3_600;          // resolver runs an hour after trading ends
const MAX_DAYS = 365;

function bad(message: string, field?: string) {
  return NextResponse.json({ error: message, field }, { status: 400 });
}

function isHttpUrl(s: unknown): s is string {
  if (typeof s !== "string" || s.length > 500) return false;
  try { const u = new URL(s); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; }
}

export async function POST(request: Request) {
  const limited = limitByIp(request, "panta-write", 30, 60_000);
  if (limited) return limited;
  if (!PANTA_LIVE) return NextResponse.json({ error: "Market creation needs a Panta API key on this server." }, { status: 503 });
  if (!PANTA_SANDBOX && !STORE_ENABLED) return NextResponse.json({ error: "Paid Panta market creation requires persistent database storage on this server." }, { status: 503 });
  if (!PANTA_SANDBOX && (!process.env.NEXT_PUBLIC_SOLANA_RPC || !(process.env.NEXT_PUBLIC_USDC_MINT || process.env.USDC_MINT)
    || process.env.NEXT_PUBLIC_SOLANA_CLUSTER !== "mainnet-beta" || /devnet|testnet/i.test(process.env.NEXT_PUBLIC_SOLANA_RPC))) {
    return NextResponse.json({ error: "Paid Panta market creation needs a configured mainnet Solana RPC and USDC mint on this server." }, { status: 503 });
  }

  const wallet = sessionWallet(request);
  if (!wallet) return NextResponse.json({ error: "Sign in with X to create a market.", needsAuth: true }, { status: 401 });
  if (overLimit("market-create", wallet, 8, 10 * 60_000)) {
    return NextResponse.json({ error: "You've started several markets in the last few minutes — wait a little." }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    question?: unknown; category?: unknown; resolutionRule?: unknown; sourcesOfTruth?: unknown; endsAt?: unknown; breaking?: unknown;
  };
  const question = typeof body.question === "string" ? body.question.trim().replace(/\s+/g, " ") : "";
  const rule = typeof body.resolutionRule === "string" ? body.resolutionRule.trim() : "";
  const category = typeof body.category === "string" ? body.category.toLowerCase() : "";
  const sources = Array.isArray(body.sourcesOfTruth) ? body.sourcesOfTruth.filter((x) => typeof x === "string" && x.trim()).map((x) => (x as string).trim()) : [];
  const breaking = body.breaking === true;
  const endsAt = typeof body.endsAt === "number" && Number.isFinite(body.endsAt) ? Math.floor(body.endsAt) : NaN;

  if (question.length < 10) return bad("Write the question in at least 10 characters.", "question");
  if (question.length > 200) return bad("Keep the question to 200 characters.", "question");
  if (!question.endsWith("?")) return bad("Phrase it as a yes/no question ending with “?”.", "question");
  if (!(PANTA_CATEGORIES as readonly string[]).includes(category)) return bad("Pick a category.", "category");
  if (rule.length < 20) return bad("Say exactly how it resolves YES — at least 20 characters.", "resolutionRule");
  if (rule.length > 2048) return bad("Resolution rule is too long (2048 max).", "resolutionRule");
  if (sources.length === 0) return bad("Add at least one source of truth (a link).", "sourcesOfTruth");
  if (sources.length > 5 || !sources.every(isHttpUrl)) return bad("Sources must be http(s) links — up to 5.", "sourcesOfTruth");

  const now = Math.floor(Date.now() / 1000);
  const startTime = breaking ? now : now + MIN_START_DELAY_SEC;
  if (!Number.isFinite(endsAt)) return bad("Pick when trading on the market ends.", "endsAt");
  if (endsAt < startTime + 600) {
    return bad(breaking
      ? "Trading must run at least 10 minutes from now."
      : "A scheduled market opens in about an hour — end it at least 10 minutes after that, or mark it as a live event.", "endsAt");
  }
  if (endsAt > now + MAX_DAYS * 86_400) return bad("End within a year.", "endsAt");

  const pantaBody = {
    wallet,
    question,
    title: question,
    resolutionRule: rule,
    sourcesOfTruth: sources,
    category,
    startTime,
    endTime: endsAt,
    resolutionTime: endsAt + RESOLVE_AFTER_SEC,
    imageUrl: `https://placehold.co/1024x1024/0a0d13/edf0f6/png?text=${encodeURIComponent(category.toUpperCase())}`,
    ...(breaking ? { marketType: "breaking", eventInProgress: true } : { marketType: "standard" })
  };

  try {
    const q = await pantaFetch<{ createId: string; paymentUsdc?: string; liquidityInjectionUsdc?: string; expiresAt?: string }>(
      "/markets/create/quote", { method: "POST", body: JSON.stringify(pantaBody) }
    );
    if (!q.createId) return NextResponse.json({ error: "Panta didn't return a quote — try again." }, { status: 502 });
    const feeUsdc = Number(q.paymentUsdc ?? "0") / 1e6;
    if (!Number.isFinite(feeUsdc) || feeUsdc < 0) return NextResponse.json({ error: "Panta returned an invalid creation fee — try again." }, { status: 502 });
    const draft = await saveDraft({
      wallet, question, category: category as PantaCategory, resolutionRule: rule, sourcesOfTruth: sources,
      endMs: endsAt * 1000, breaking, createId: q.createId, feeUsdc, quoteExpiresAt: q.expiresAt ?? null
    });
    return NextResponse.json({
      draftId: draft.draftId,
      feeUsdc,
      liquidityUsdc: Number(q.liquidityInjectionUsdc ?? "0") / 1e6,
      // Sandbox keys quote a fee but build no transaction — nothing is charged.
      sandbox: PANTA_SANDBOX,
      expiresAt: q.expiresAt ?? null
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Panta failed";
    console.error("panta /markets/create/quote failed:", msg);
    return NextResponse.json({ error: msg.includes("DUPLICATE_MARKET") ? "A market with this question already exists — reword it or host a pit on the existing one." : `Panta rejected the market: ${msg.slice(0, 160)}` }, { status: 502 });
  }
}
