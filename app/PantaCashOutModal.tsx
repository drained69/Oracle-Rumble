"use client";

/**
 * PantaCashOutModal — parlayit-style early-exit for an open parlay.
 *
 * Shows the per-leg live side price, the fair mid-value, the cashout fee,
 * and the net payout. On confirm hits POST /api/round/parlay/cashout,
 * which re-prices atomically inside the round-store lock. The button
 * only fires while the round is "live" — the modal is dismissed on
 * success or refusal.
 *
 * Cashout is intentionally an internal-vault operation: Panta v1 has no
 * sell endpoint on the primary bonding curve, so tickets close against
 * the round vault (mid-priced from live Panta / board prices).
 */

import { useCallback, useEffect, useState } from "react";
import type { ParlayTicket } from "@/lib/royale";
import { cashOutParlayApi } from "@/lib/round-client";
import { CASHOUT_FEE_RATE, CASHOUT_FEE_CAP_USDC } from "@/lib/parlay";
import { useEscapeKey } from "@/lib/use-escape";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

type Quote = NonNullable<Awaited<ReturnType<typeof cashOutParlayApi>>["quote"]>;

export default function PantaCashOutModal({
  ticket, wallet, arena, onClose, onSuccess
}: {
  ticket: ParlayTicket;
  wallet: string;
  arena: string;
  onClose: () => void;
  onSuccess?: (netUsdc: number) => void;
}) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [phase, setPhase] = useState<"preview" | "committing" | "done" | "error">("preview");
  const [error, setError] = useState<string | null>(null);
  useEscapeKey(phase !== "committing", onClose);

  /**
   * Preview is a dry-run that hits the same server pricing so the number
   * shown matches what would land on confirm. We DO NOT commit here — the
   * server marks cashed_out on the first cashout call, so we run a
   * client-only preview by fetching prices for each leg and re-running
   * the same math. Simpler: use the real endpoint but return early if
   * the ticket already settled.
   *
   * For simplicity we ask the server for a preview by looking up the
   * ticket's own state — because the endpoint is idempotent-guarded
   * (ticket must be status===open) we can't preview by hitting it. So we
   * compute a client-side estimate from ticket entry prices as the
   * baseline; the server value on confirm is authoritative.
   */
  useEffect(() => {
    let cancelled = false;
    // Client-side estimate — advisory only; the server re-prices at confirm.
    (async () => {
      try {
        // The round's own live leg prices — the same ones the server
        // prices the cash-out at.
        let yesPricesByMarket: Record<string, number> = {};
        try {
          const res = await fetch(`/api/round?arena=${encodeURIComponent(arena)}`, { cache: "no-store" });
          const j = (await res.json()) as { prices?: Record<string, number> };
          yesPricesByMarket = j.prices ?? {};
        } catch { /* fall back to entry prices */ }
        if (cancelled) return;
        // Cheap client-side mirror of quoteCashOut.
        let prob = 1;
        const legs = ticket.legs.map((l) => {
          const yes = yesPricesByMarket[l.marketId];
          const sideNow = yes !== undefined ? (l.side === "YES" ? yes : 100 - yes) : (l.side === "YES" ? l.entryPrice : 100 - l.entryPrice);
          const clamped = Math.max(1, Math.min(99, sideNow));
          prob *= clamped / 100;
          return { marketId: l.marketId, side: l.side, entryPrice: l.entryPrice, currentSidePrice: clamped, question: l.question };
        });
        const fair = ticket.shares * prob;
        const fee = Math.min(fair * CASHOUT_FEE_RATE, CASHOUT_FEE_CAP_USDC);
        const net = Math.max(0, fair - fee);
        setQuote({
          liveCombinedPrice: Math.max(0.01, prob * 100),
          fairValueUsdc: Math.round(fair * 100) / 100,
          cashoutFeeUsdc: Math.round(fee * 100) / 100,
          netCashoutUsdc: Math.round(net * 100) / 100,
          originalStakeUsdc: ticket.stake,
          pnlUsdc: Math.round((net - ticket.stake) * 100) / 100,
          legs
        });
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [ticket, arena]);

  const commit = useCallback(async () => {
    setPhase("committing"); setError(null);
    try {
      const res = await cashOutParlayApi(wallet, ticket.id, arena);
      if (res.error) {
        setError(res.error);
        setPhase("error");
        return;
      }
      if (res.quote) setQuote(res.quote);
      setPhase("done");
      onSuccess?.(res.quote?.netCashoutUsdc ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [wallet, ticket.id, arena, onSuccess]);

  const closeBtnLabel = phase === "done" ? "Close" : phase === "committing" ? "…" : "Cancel";

  return (
    <div className="modal-backdrop" onClick={phase === "committing" ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <button className="close" onClick={onClose} aria-label="Close" disabled={phase === "committing"}>×</button>
        <h2>{phase === "done" ? "Cashed out" : "Cash out parlay"}</h2>
        <p className="sub">
          {phase === "done"
            ? <>Ticket closed early. Payout credited to your vault.</>
            : <>Close this ticket now at the live mid-price. {ticket.legs.length}-leg parlay — parlayit-style early exit.</>}
        </p>

        <div className="cashout-legs">
          {ticket.legs.map((l) => {
            const liveLeg = quote?.legs.find((q) => q.marketId === l.marketId);
            const drift = liveLeg ? liveLeg.currentSidePrice - l.entryPrice : 0;
            return (
              <div key={l.marketId} className="cashout-leg">
                <div className="cashout-leg-line">
                  <span className={`side ${l.side === "YES" ? "up" : "down"}`}>{l.side === "YES" ? "UP" : "DOWN"}</span>
                  <span className="q">{l.question || l.marketId}</span>
                </div>
                <div className="cashout-leg-line small">
                  <span>Entry {l.entryPrice}¢</span>
                  {liveLeg && <span>Now {liveLeg.currentSidePrice}¢</span>}
                  {liveLeg && <span className={drift >= 0 ? "up" : "down"}>{drift >= 0 ? "+" : ""}{drift}¢</span>}
                </div>
              </div>
            );
          })}
        </div>

        <div className="cashout-summary">
          <div><span>Original stake</span><b>{quote ? usd.format(quote.originalStakeUsdc) : "—"}</b></div>
          <div><span>Live combined price</span><b>{quote ? `${quote.liveCombinedPrice.toFixed(1)}¢` : "…"}</b></div>
          <div><span>Fair value</span><b>{quote ? usd.format(quote.fairValueUsdc) : "…"}</b></div>
          <div><span>Cashout fee (2%)</span><b>{quote ? usd.format(quote.cashoutFeeUsdc) : "…"}</b></div>
          <div className="net"><span>You receive</span><b className="up">{quote ? usd.format(quote.netCashoutUsdc) : "…"}</b></div>
          <div className={quote && quote.pnlUsdc >= 0 ? "up" : "down"}>
            <span>P&amp;L vs stake</span>
            <b>{quote ? `${quote.pnlUsdc >= 0 ? "+" : ""}${usd.format(quote.pnlUsdc)}` : "…"}</b>
          </div>
        </div>

        {error && <p className="pcm-error" style={{ marginTop: 12 }}>{error}</p>}

        <p className="disclaimer" style={{ marginTop: 12 }}>
          Cashout resolves against the round vault. Panta v1 has no sell endpoint on the primary book — this is the parlayit early-exit design implemented on the game layer.
        </p>

        <div className="pcm-actions">
          <button className="btn secondary" onClick={onClose} disabled={phase === "committing"}>{closeBtnLabel}</button>
          {phase !== "done" && (
            <button className="btn primary" onClick={commit} disabled={phase === "committing" || !quote}>
              {phase === "committing" ? "Cashing out…" : quote ? `Cash out ${usd.format(quote.netCashoutUsdc)}` : "Loading…"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
