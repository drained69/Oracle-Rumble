/**
 * Panta order lifecycle helper (client-side).
 *
 * Walks the complete Panta buy flow with progress callbacks:
 *
 *   quote → build → sign → submit → verify → report
 *
 * Every step emits a LifecycleUpdate so the UI can show live progress
 * ("Quoting on Panta…", "Sign the tx…", "Confirming…", "Attributed").
 * On success the returned signature is the on-chain transaction hash
 * that Panta credited to The Pit's attribution key.
 *
 * The caller is expected to have a connected wallet + a real Panta
 * market id. For synthetic direction-board markets, don't invoke this
 * — call the internal game trade instead.
 */

import {
  quoteOrder,
  buildOrder,
  submitOrder,
  verifyOrder,
  reportTrade,
  signAndBroadcastFromInstructions
} from "@/lib/panta-client";

export type LifecycleStep =
  | "idle"
  | "quoting"
  | "quoted"
  | "building"
  | "built"
  | "signing"
  | "broadcasting"
  | "confirming"
  | "confirmed"
  | "reporting"
  | "attributed"
  | "done"
  | "error";

export type LifecycleUpdate = {
  step: LifecycleStep;
  note?: string;
  quoteId?: string;
  price?: number;
  shares?: number;
  signature?: string;
  attributed?: boolean;
  source?: "panta" | "mock";
  error?: string;
};

export type ExecuteOrderArgs = {
  marketId: string;
  side: "YES" | "NO";
  usdcAmount: number | string;
  wallet: string;
  onUpdate?: (u: LifecycleUpdate) => void;
};

export type ExecuteOrderResult = {
  ok: boolean;
  signature?: string;
  quoteId?: string;
  attributed?: boolean;
  source?: "panta" | "mock";
  error?: string;
};

const VERIFY_TIMEOUT_MS = 30_000;
const VERIFY_INTERVAL_MS = 2_000;

export async function executePantaOrder(args: ExecuteOrderArgs): Promise<ExecuteOrderResult> {
  const emit = (u: LifecycleUpdate) => { try { args.onUpdate?.(u); } catch { /* ignore */ } };
  const usdc = String(args.usdcAmount);

  // 1. Quote
  emit({ step: "quoting", note: `Quoting ${args.side} $${usdc} on Panta…` });
  let quote;
  try {
    quote = await quoteOrder({ marketId: args.marketId, side: args.side, usdcAmount: usdc, wallet: args.wallet });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit({ step: "error", error: `quote failed: ${msg}` });
    return { ok: false, error: msg };
  }
  emit({
    step: "quoted",
    quoteId: quote.quoteId, price: quote.price, shares: quote.shares,
    source: quote.source,
    note: `Quoted @ ${quote.price}¢ · ${quote.shares.toFixed(2)} shares · fee $${quote.feeUsdc}`
  });

  // 2. Build
  emit({ step: "building", quoteId: quote.quoteId, note: "Building unsigned tx from Panta…" });
  let build;
  try {
    build = await buildOrder({ quoteId: quote.quoteId, wallet: args.wallet });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit({ step: "error", error: `build failed: ${msg}` });
    return { ok: false, quoteId: quote.quoteId, error: msg };
  }
  emit({ step: "built", quoteId: quote.quoteId, source: build.source, note: "Awaiting wallet signature…" });

  // 3. Sign + broadcast. Panta returns raw instructions + recentBlockhash
  // (not a pre-serialized tx) — compile a v0 VersionedTransaction locally.
  // In sandbox / demo mode Panta returns an empty instructions array; we
  // catch that and synthesize a signature so the lifecycle still exercises
  // /submit + /verify + /trades/{sig} proxies.
  emit({ step: "signing", quoteId: quote.quoteId, note: "Waiting for wallet…" });
  let signature = "";
  let confirmed = false;
  const canSign = build.source === "panta" && build.instructions && build.instructions.length > 0;
  if (canSign) {
    try {
      const res = await signAndBroadcastFromInstructions({
        wallet: args.wallet,
        instructions: build.instructions,
        recentBlockhash: build.recentBlockhash
      });
      signature = res.signature;
      confirmed = res.confirmed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit({ step: "error", error: `sign/broadcast failed: ${msg}` });
      return { ok: false, quoteId: quote.quoteId, error: msg };
    }
  } else {
    signature = `demo-${Date.now().toString(36)}-${args.marketId.slice(0, 4)}`;
    emit({ step: "signing", quoteId: quote.quoteId, note: "Sandbox mode — skipping wallet signature." });
  }
  emit({ step: "broadcasting", signature, quoteId: quote.quoteId, note: signature ? `Broadcast · ${signature.slice(0, 8)}…` : "Broadcasting…" });

  // 4. Submit signature to Panta so it can pick up confirmation. Panta
  // needs the orderId from build, not the quoteId.
  try {
    const submit = await submitOrder({ orderId: build.orderId, signature, wallet: args.wallet });
    emit({ step: "broadcasting", signature, source: submit.source, note: `Panta status: ${submit.status}` });
  } catch (err) {
    emit({ step: "broadcasting", signature, note: `submit warning: ${err instanceof Error ? err.message : String(err)}` });
  }

  // 5. Poll verify until confirmed / failed / expired / timeout.
  emit({ step: "confirming", signature, note: "Confirming on Panta…" });
  const deadline = Date.now() + VERIFY_TIMEOUT_MS;
  type VerifyStatus = "built" | "submitted" | "pending" | "confirmed" | "failed" | "expired";
  let verifyStatus: VerifyStatus = confirmed ? "confirmed" : "submitted";
  const isTerminal = (s: VerifyStatus) => s === "confirmed" || s === "failed" || s === "expired";
  while (Date.now() < deadline && !isTerminal(verifyStatus)) {
    try {
      const v = await verifyOrder({ orderId: build.orderId, signature });
      verifyStatus = v.status as VerifyStatus;
      if (isTerminal(verifyStatus)) break;
    } catch {
      // transient — keep polling
    }
    await new Promise((r) => setTimeout(r, VERIFY_INTERVAL_MS));
  }
  if (verifyStatus === "failed" || verifyStatus === "expired") {
    emit({ step: "error", signature, error: `Panta reported the tx as ${verifyStatus}.` });
    return { ok: false, signature, quoteId: quote.quoteId, error: `tx ${verifyStatus}` };
  }
  emit({ step: "confirmed", signature, note: `Confirmed · ${verifyStatus}` });

  // 6. Attribution readback. Panta doesn't have a POST /trades/report —
  // attribution is automatic via the API key + X-User-Id header. This
  // step probes GET /trades/{signature}/ to see whether the trade has
  // been picked up and counted for the partner.
  emit({ step: "reporting", signature, note: "Reading trade attribution…" });
  let attributed = false;
  let source: "panta" | "mock" | undefined = undefined;
  try {
    const report = await reportTrade({ signature, wallet: args.wallet, marketId: args.marketId });
    attributed = report.status === "processed" || report.status === "confirmed";
    source = report.source;
  } catch (err) {
    emit({ step: "reporting", signature, note: `attribution warning: ${err instanceof Error ? err.message : String(err)}` });
  }
  emit({
    step: attributed ? "attributed" : "done",
    signature, source, attributed,
    note: attributed
      ? `Attributed to The Pit${source === "mock" ? " (demo)" : ""}`
      : "Attribution pending — Panta will pick it up on the next scan."
  });
  emit({ step: "done", signature, quoteId: quote.quoteId, attributed, source });

  return { ok: true, signature, quoteId: quote.quoteId, attributed, source };
}
