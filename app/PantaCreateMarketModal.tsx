"use client";

/**
 * PantaCreateMarketModal — full Panta market-creation lifecycle in one
 * modal. Walks marketCreateQuote → marketCreateBuild → sign →
 * marketCreateRegister and shows every step with error surfaces.
 *
 * The returned marketId is auto-added to the tracked-markets store by
 * the panta-client wrapper, so PantaGraduationBanner starts watching for
 * the primary → graduated flip immediately.
 *
 * The form is deliberately faithful to Panta's schema:
 *   • question         ≤ 512 chars
 *   • resolutionRule   ≤ 2048 chars
 *   • sourcesOfTruth   1..20 URLs, one per line
 *   • category         allowlist (sports / crypto / politics / entertainment / finance / science / world / other)
 *   • startTime / endTime / resolutionTime  unix seconds
 *   • imageUrl         http/https, ≤ 2048 chars
 */

import { useEffect, useMemo, useState } from "react";
import { marketCreateQuote, marketCreateBuild, marketCreateRegister, signAndBroadcast, connectSolanaWallet } from "@/lib/panta-client";

type Step = "draft" | "quoted" | "signing" | "registering" | "done" | "error";

const CATEGORIES = ["sports", "crypto", "politics", "entertainment", "finance", "science", "world", "other"] as const;
const DEFAULT_IMG = "https://placehold.co/600x400/0f131b/22c55e/png?text=New+Panta+Market";

function isoLocal(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localToUnix(s: string): number {
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}
function fmtUsdcFromBase(base: string | undefined): string {
  if (!base) return "—";
  const n = Number(base);
  if (!Number.isFinite(n)) return String(base);
  return `$${(n / 1_000_000).toFixed(2)}`;
}

export default function PantaCreateMarketModal({ initialWallet, onClose }: { initialWallet: string | null; onClose: () => void }) {
  const now = Math.floor(Date.now() / 1000);
  const [wallet, setWallet] = useState<string | null>(initialWallet);
  const [question, setQuestion] = useState("");
  const [resolutionRule, setResolutionRule] = useState("");
  const [sourcesText, setSourcesText] = useState("");
  const [category, setCategory] = useState<typeof CATEGORIES[number]>("crypto");
  const [startTime, setStartTime] = useState(isoLocal(now + 300));
  const [endTime, setEndTime] = useState(isoLocal(now + 7 * 86400));
  const [resolutionTime, setResolutionTime] = useState(isoLocal(now + 7 * 86400 + 7200));
  const [imageUrl, setImageUrl] = useState(DEFAULT_IMG);
  const [step, setStep] = useState<Step>("draft");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<{ createId: string; paymentUsdc: string; expectedEventPda: string; liquidityInjectionUsdc?: string; platformRevenueUsdc?: string; source: "panta" | "mock" } | null>(null);
  const [registered, setRegistered] = useState<{ marketId: string; source: "panta" | "mock"; signature?: string } | null>(null);

  const sourcesOfTruth = useMemo(() => sourcesText
    .split(/\r?\n/).map((s) => s.trim())
    .filter((s) => s.length > 0), [sourcesText]);

  const canQuote = wallet && question.trim().length > 0 && question.length <= 512
    && resolutionRule.trim().length > 0 && resolutionRule.length <= 2048
    && sourcesOfTruth.length > 0 && sourcesOfTruth.length <= 20
    && localToUnix(startTime) > 0 && localToUnix(endTime) > localToUnix(startTime)
    && localToUnix(resolutionTime) >= localToUnix(endTime)
    && imageUrl.startsWith("http");

  useEffect(() => { if (!wallet) setStep("draft"); }, [wallet]);

  const doConnect = async () => {
    const pk = await connectSolanaWallet();
    if (pk) setWallet(pk);
    else setError("No Solana wallet detected. Install Phantom, Backpack, or Solflare.");
  };

  const doQuote = async () => {
    if (!wallet) return;
    setBusy(true); setError("");
    try {
      const q = await marketCreateQuote({
        wallet,
        question: question.trim(),
        resolutionRule: resolutionRule.trim(),
        sourcesOfTruth,
        category,
        startTime: localToUnix(startTime),
        endTime: localToUnix(endTime),
        resolutionTime: localToUnix(resolutionTime),
        imageUrl: imageUrl.trim()
      });
      setQuote(q);
      setStep("quoted");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    } finally { setBusy(false); }
  };

  const doSignAndRegister = async () => {
    if (!quote || !wallet) return;
    setBusy(true); setError(""); setStep("signing");
    try {
      const build = await marketCreateBuild({ createId: quote.createId, wallet });
      let signature: string;
      if (build.transaction) {
        // Real Panta path: wallet signs the tx.
        const res = await signAndBroadcast({ serializedTx: build.transaction, wallet });
        signature = res.signature;
      } else {
        // Sandbox mode: Panta returned an empty transaction — skip signing.
        signature = `sandbox-${Date.now().toString(36)}`;
      }
      setStep("registering");
      const reg = await marketCreateRegister({ createId: quote.createId, signature });
      setRegistered({ marketId: reg.marketId, source: reg.source, signature });
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal host-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <button className="close" onClick={onClose} aria-label="Close">×</button>

        {step === "done" && registered ? (
          <>
            <h2>Panta market registered</h2>
            <p className="sub">
              Your market is live on <b>{registered.source === "panta" ? "Panta live-api" : "Panta sandbox"}</b>.
              It&apos;s already being watched — you&apos;ll get a banner if it graduates.
            </p>
            <div className="pcm-summary">
              <div><span>Market ID</span><b className="mono">{registered.marketId.slice(0, 6)}…{registered.marketId.slice(-6)}</b></div>
              <div><span>Category</span><b>{category}</b></div>
              <div><span>Payment</span><b>{fmtUsdcFromBase(quote?.paymentUsdc)}</b></div>
              {registered.signature && registered.signature.length > 20 && (
                <div>
                  <span>Tx</span>
                  <a className="mono link"
                    href={`https://explorer.solana.com/tx/${registered.signature}${(process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet") === "mainnet-beta" ? "" : `?cluster=${process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet"}`}`}
                    target="_blank" rel="noopener noreferrer">
                    {registered.signature.slice(0, 8)}… ↗
                  </a>
                </div>
              )}
            </div>
            <p className="disclaimer" style={{ marginTop: 12 }}>
              Panta will run its AI Resolver at the resolution timestamp. Once the market graduates from the primary book to secondary you earn <b>20%</b> of the trading fees for as long as it keeps trading.
            </p>
            <button className="btn primary full" onClick={onClose} style={{ marginTop: 12 }}>Done</button>
          </>
        ) : step === "quoted" && quote ? (
          <>
            <h2>Confirm and sign</h2>
            <p className="sub">Panta priced the market. Sign the create tx from your wallet to register it on-chain.</p>
            <div className="pcm-summary">
              <div><span>Create ID</span><b className="mono">{quote.createId}</b></div>
              <div><span>Payment</span><b>{fmtUsdcFromBase(quote.paymentUsdc)}</b></div>
              {quote.liquidityInjectionUsdc && <div><span>Liquidity injection</span><b>{fmtUsdcFromBase(quote.liquidityInjectionUsdc)}</b></div>}
              {quote.platformRevenueUsdc && <div><span>Platform revenue</span><b>{fmtUsdcFromBase(quote.platformRevenueUsdc)}</b></div>}
              <div><span>Expected market PDA</span><b className="mono small">{quote.expectedEventPda.slice(0, 8)}…{quote.expectedEventPda.slice(-6)}</b></div>
              <div><span>Source</span><b className={quote.source === "panta" ? "up" : "amber"}>{quote.source === "panta" ? "LIVE" : "DEMO"}</b></div>
            </div>
            {error && <p className="pcm-error">{error}</p>}
            <div className="pcm-actions">
              <button className="btn secondary" onClick={() => setStep("draft")} disabled={busy}>Back</button>
              <button className="btn primary" onClick={doSignAndRegister} disabled={busy}>
                {busy ? "Signing & registering…" : "Sign & register"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>Create a Panta market</h2>
            <p className="sub">Full Panta lifecycle: quote → build → sign → register. Earns you 20% of fees once the market graduates.</p>

            {!wallet && (
              <div className="pcm-warn">
                No wallet connected — Panta needs a fee-payer to build the create tx.
                <button className="link-btn" onClick={doConnect}>Connect wallet</button>
              </div>
            )}

            <div className="pcm-field">
              <label>Question <em>({question.length}/512)</em></label>
              <textarea value={question} onChange={(e) => setQuestion(e.target.value.slice(0, 512))} rows={2}
                placeholder="e.g. Will Solana close above $250 on 2026-12-31?" />
            </div>

            <div className="pcm-field">
              <label>Resolution rule <em>({resolutionRule.length}/2048)</em></label>
              <textarea value={resolutionRule} onChange={(e) => setResolutionRule(e.target.value.slice(0, 2048))} rows={3}
                placeholder="How and by whom the market resolves. Cite exact criteria and data sources." />
            </div>

            <div className="pcm-field">
              <label>Sources of truth <em>(one URL per line, 1–20)</em></label>
              <textarea value={sourcesText} onChange={(e) => setSourcesText(e.target.value)} rows={3}
                placeholder={"https://coingecko.com/en/coins/solana\nhttps://coinmarketcap.com/currencies/solana/"} />
              {sourcesOfTruth.length > 0 && <span className="pcm-hint">{sourcesOfTruth.length} URL{sourcesOfTruth.length === 1 ? "" : "s"} parsed</span>}
            </div>

            <div className="pcm-row">
              <div className="pcm-field">
                <label>Category</label>
                <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="pcm-field">
                <label>Image URL</label>
                <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
              </div>
            </div>

            <div className="pcm-row3">
              <div className="pcm-field">
                <label>Starts</label>
                <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div className="pcm-field">
                <label>Ends</label>
                <input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </div>
              <div className="pcm-field">
                <label>Resolves</label>
                <input type="datetime-local" value={resolutionTime} onChange={(e) => setResolutionTime(e.target.value)} />
              </div>
            </div>

            {imageUrl.startsWith("http") && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="pcm-preview" src={imageUrl} alt="market preview" />
            )}

            {error && <p className="pcm-error">{error}</p>}

            <button className="btn primary full" onClick={doQuote} disabled={!canQuote || busy}>
              {busy ? "Quoting on Panta…" : "Get a quote from Panta"}
            </button>
            <p className="disclaimer" style={{ marginTop: 10 }}>
              This calls Panta&apos;s <code>/markets/create/quote</code>. No wallet signature yet — you review the price first.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
