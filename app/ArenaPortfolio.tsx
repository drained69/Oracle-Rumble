"use client";

/**
 * A wallet's arena portfolio: payouts ready to withdraw, positions in live
 * and enrolling arenas, and finished arenas — from GET /api/portfolio, which
 * merges the game ledger with the wallet's on-chain deposits.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Portfolio, PortfolioItem } from "@/lib/portfolio";
import { claimFromEscrow, serverSettleArena, seatStepText } from "@/lib/round-client";
import { netOfClaimFee } from "@/lib/fees";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").toLowerCase();

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const clock = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};
const sideWord = (s: "YES" | "NO") => (s === "YES" ? "UP" : "DOWN");
const ACTIVE = new Set(["enrolling", "live", "settling", "advancing"]);

function explorer(vault: string) {
  return `https://explorer.solana.com/address/${vault}${CLUSTER === "mainnet-beta" ? "" : `?cluster=${CLUSTER}`}`;
}

/** One-line result of a finished arena for this player. */
function resultLine(i: PortfolioItem): string {
  const me = i.me;
  if (i.status === "unknown") return "The game's record of this pit isn't available, but your payout is recorded on chain.";
  if (i.status === "cancelled") return i.chain ? "Pit cancelled before it started — your seat is refunded in full." : "Pit cancelled before it started.";
  if (!me) return i.chain ? "You paid a seat but weren't seated — it's refunded in full." : "";
  const place = me.place ? `${ordinal(me.place)} of ${me.players}` : "Finished";
  const prize = (me.prizeUsdc > 0 ? ` · won ${usd.format(me.prizeUsdc)} from the pool` : "")
    + (me.hostFeeUsdc > 0 ? ` · ${usd.format(me.hostFeeUsdc)} host fee` : "");
  if (i.format === "predictions") return `${place} · ${me.score ?? 0} pt${me.score === 1 ? "" : "s"}${prize || " · no prize this time"}`;
  if (i.format === "streak") return `${place} · lasted ${me.score ?? 0} leg${(me.score ?? 0) === 1 ? "" : "s"}${prize || " · no prize this time"}`;
  const out = me.eliminatedRound ? ` · knocked out in round ${me.eliminatedRound}` : "";
  return `${place}${out}${prize} · vault finished at ${usd.format(me.cash)}`;
}

export default function ArenaPortfolio({ wallet, onToast }: { wallet: string; onToast: (m: string) => void }) {
  const [data, setData] = useState<Portfolio | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const nudged = useRef(new Map<string, number>());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/portfolio?wallet=${encodeURIComponent(wallet)}`, { cache: "no-store" });
      const j = (await res.json()) as Portfolio & { error?: string };
      if (!res.ok) { setLoadError(j.error ?? "Couldn't load your pits."); return; }
      setData(j);
      setLoadError(j.error ?? "");
    } catch {
      setLoadError("Couldn't reach the server — retrying.");
    }
  }, [wallet]);

  useEffect(() => { setData(null); void load(); }, [load]);

  const anyActive = !!data?.items.some((i) => ACTIVE.has(i.status));
  useEffect(() => {
    const id = window.setInterval(load, anyActive ? 8_000 : 30_000);
    return () => window.clearInterval(id);
  }, [load, anyActive]);
  useEffect(() => {
    if (!anyActive) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [anyActive]);

  // Arenas only advance when someone loads them (the keeper runs on reads).
  // When a deadline has passed, load the arena so its round locks / settles
  // while the player watches from here.
  useEffect(() => {
    const due = (data?.items ?? []).filter((i) => i.arena && ACTIVE.has(i.status) && i.deadline && now > i.deadline);
    for (const i of due) {
      const key = `tick:${i.arena}`;
      if (Date.now() - (nudged.current.get(key) ?? 0) < 4_000) continue;
      nudged.current.set(key, Date.now());
      void fetch(`/api/round?arena=${encodeURIComponent(i.arena)}`, { cache: "no-store" }).then(() => load()).catch(() => {});
    }
  }, [data, now, load]);

  // Finished arenas still waiting for their on-chain settlement: nudge it
  // (idempotent server-side), so payouts open even if nobody reopens the arena.
  useEffect(() => {
    for (const i of data?.items ?? []) {
      if (i.action !== "settling" || !i.arena) continue;
      const last = nudged.current.get(i.arena) ?? 0;
      if (Date.now() - last < 20_000) continue;
      nudged.current.set(i.arena, Date.now());
      void serverSettleArena(i.arena).then(() => window.setTimeout(load, 4_000)).catch(() => {});
    }
  }, [data, load]);

  const withdraw = useCallback(async (i: PortfolioItem) => {
    const key = i.arena || i.chain?.roundVault || "";
    setBusy(key);
    onToast("Approve the withdrawal in your wallet…");
    try {
      const r = await claimFromEscrow(wallet, i.arena, i.action === "recover", (name) => onToast(seatStepText("waiting", 0, null, name).toast), i.chain?.roundVault,
        () => onToast("That took over a minute, so Solana needs a fresh signature — approve the withdrawal once more in your wallet."));
      if (r.error) onToast(r.error);
      else onToast(`${usd.format(i.actionUsdc)} is on its way to your wallet.`);
      await load();
    } finally { setBusy(null); }
  }, [wallet, onToast, load]);

  if (!data) {
    return <div className="positions-shell"><div className="positions-empty">{loadError || "Loading your pits…"}</div></div>;
  }

  const claimable = data.items.filter((i) => i.action === "claim" || i.action === "recover");
  const active = data.items.filter((i) => ACTIVE.has(i.status) && !claimable.includes(i));
  const history = data.items.filter((i) => !claimable.includes(i) && !active.includes(i));

  return (
    <div className="pf">
      <div className="positions-shell">
        <div className="positions-stats">
          <div><span>Active pits</span><b>{data.summary.active}</b></div>
          <div><span>In play</span><b>{usd.format(data.summary.inPlayUsdc)}</b></div>
          <div><span>Ready to withdraw</span><b className={data.summary.claimableUsdc > 0 ? "up" : ""}>{usd.format(data.summary.claimableUsdc)}</b></div>
          <div><span>Prizes won</span><b>{usd.format(data.summary.prizesUsdc)}</b></div>
        </div>
        {loadError && <p className="pf-warn" role="status">{loadError}</p>}
      </div>

      {data.items.length === 0 && (
        <div className="positions-shell">
          <div className="positions-empty">
            <p>You haven&apos;t played a pit with this wallet yet.</p>
            <a className="btn-cta" href="/" style={{ marginTop: 14, display: "inline-flex" }}>Find a pit</a>
          </div>
        </div>
      )}

      {claimable.length > 0 && (
        <section className="pf-section" aria-labelledby="pf-claim">
          <h2 id="pf-claim">Ready to withdraw</h2>
          {claimable.map((i) => {
            const key = i.arena || i.chain!.roundVault;
            return (
              <article key={key} className="pf-card claim">
                <div className="pf-head">
                  {i.arena ? <a className="pf-code" href={`/a/${i.arena}`}>{i.arena}</a> : <span className="pf-code">Vault {i.chain!.roundVault.slice(0, 4)}…</span>}
                  <span className="pf-q">{i.question}</span>
                </div>
                <p className="pf-line">
                  {i.action === "recover"
                    ? "This pit was never settled and its recovery window is open — take your full seat back."
                    : resultLine(i)}
                </p>
                {(() => {
                  // Claims from newer vaults pay the 0.1% platform fee; recoveries don't.
                  const bps = i.action === "claim" ? i.chain?.claimFeeBps ?? 0 : 0;
                  const net = netOfClaimFee(i.actionUsdc, bps);
                  return (
                    <div className="pf-foot">
                      <b className="pf-amount">{usd.format(net)}{bps > 0 && <em className="fee-note"> after {(bps / 100).toFixed(1)}% fee</em>}</b>
                      <button className="btn primary" onClick={() => withdraw(i)} disabled={busy !== null}>
                        {busy === key ? "Confirm in your wallet…" : i.action === "recover" ? `Recover ${usd.format(net)}` : `Withdraw ${usd.format(net)}`}
                      </button>
                    </div>
                  );
                })()}
              </article>
            );
          })}
        </section>
      )}

      {active.length > 0 && (
        <section className="pf-section" aria-labelledby="pf-active">
          <h2 id="pf-active">In play</h2>
          {active.map((i) => <ActiveCard key={i.arena} i={i} now={now} />)}
        </section>
      )}

      {history.length > 0 && (
        <section className="pf-section" aria-labelledby="pf-history">
          <h2 id="pf-history">History</h2>
          {history.map((i) => (
            <article key={i.arena || i.chain?.roundVault} className="pf-card done">
              <div className="pf-head">
                {i.arena ? <a className="pf-code" href={`/a/${i.arena}`}>{i.arena}</a> : <span className="pf-code">Vault</span>}
                <span className="pf-q">{i.question}</span>
                {i.practice && <span className="pf-chip practice">Practice</span>}
              </div>
              <p className="pf-line">{resultLine(i)}</p>
              {i.chain && (
                <p className="pf-sub">
                  {i.action === "claimed" ? <>Withdrawn ✓ {usd.format(i.chain.entitlementUsdc)}</>
                    : i.action === "settling" ? <>Settling on chain — your payout opens here in a minute or two.</>
                    : i.chain.claimsOpen ? (i.format === "predictions" || i.format === "streak" ? <>No prize this time — nothing to withdraw.</> : <>Nothing to withdraw — the vault finished at $0.</>)
                    : <>Waiting for settlement.</>}
                  {" · "}<a href={explorer(i.chain.roundVault)} target="_blank" rel="noopener noreferrer">Vault ↗</a>
                </p>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function ActiveCard({ i, now }: { i: PortfolioItem; now: number }) {
  const me = i.me;
  const left = i.deadline ? i.deadline - now : 0;
  const chip = i.status === "enrolling" ? `Enrolling${i.deadline ? ` · locks in ${clock(left)}` : ""}`
    : i.status === "live" ? `Live${i.deadline ? ` · ${clock(left)} left` : ""}`
    : "Settling";
  const delta = me ? me.vault - me.startingVault : 0;
  const above = me && me.place !== null && me.eliminatedRound === null ? me.place <= me.survivors : null;
  return (
    <article className="pf-card live">
      <div className="pf-head">
        <a className="pf-code" href={`/a/${i.arena}`}>{i.arena}</a>
        <span className="pf-q">{i.question}</span>
        <span className={`pf-chip ${i.status === "live" ? "live" : "enrolling"}`}>{chip}</span>
        {i.practice && <span className="pf-chip practice">Practice</span>}
      </div>

      {!me ? (
        <p className="pf-line">Your deposit is in — your seat is being registered.</p>
      ) : i.format === "streak" && me.streak ? (
        <p className="pf-line">
          {!me.streak.alive ? <>Knocked out on leg {me.eliminatedRound} — you lasted {me.score ?? 0} leg{(me.score ?? 0) === 1 ? "" : "s"}.</>
            : i.status === "enrolling" ? <>You&apos;re in. The streak starts when enrollment closes — keep the pit open, each leg gives 20 seconds to pick.</>
            : <><b className="up">Still in</b> · leg {me.streak.leg} of up to {me.streak.maxLegs}{me.streak.picked ? "" : <> — <b className="down">open the pit to pick</b></>}.</>}
        </p>
      ) : i.format === "predictions" ? (
        i.status === "enrolling" ? (
          <p className="pf-line">
            {me.picksMade === null ? <>Your picks are hidden until the round locks.</>
              : me.picksMade >= me.questions ? <>All {me.questions} picks made — you can change them until the round locks.</>
              : <><b className="down">{me.picksMade} of {me.questions} picks made.</b> Finish them before the round locks — an empty pick scores nothing.</>}
          </p>
        ) : (
          <div className="pf-grid">
            <div><span>Right so far</span><b>{me.score ?? 0} / {me.questions}</b></div>
            <div>
              <span>Standing</span>
              <b>
                {me.place ? `${ordinal(me.place)} of ${me.players}` : "—"}
                {me.inMoney !== null && <em className={me.inMoney ? "up" : "down"}>{me.inMoney ? " in the money" : " out of the money"}</em>}
              </b>
            </div>
          </div>
        )
      ) : i.status === "enrolling" ? (
        <p className="pf-line">
          {me.openingCall
            ? <>Opening call <b className={me.openingCall === "YES" ? "up" : "down"}>{sideWord(me.openingCall)}</b> — {(me.openingCallPct ?? 100) >= 100 ? `your whole ${usd.format(me.cash)} vault goes` : `${usd.format((me.cash * (me.openingCallPct ?? 100)) / 100)} of your ${usd.format(me.cash)} vault goes`} on it when trading opens.</>
            : <>No opening call — you&apos;ll pick UP or DOWN once trading opens. Vault {usd.format(me.cash)}.</>}
        </p>
      ) : (
        <div className="pf-grid">
          <div>
            <span>Position</span>
            <b>{me.side ? <><em className={me.side === "YES" ? "up" : "down"}>{sideWord(me.side)}</em> {me.shares.toFixed(2)} sh</> : "Cash"}</b>
          </div>
          <div><span>Entry → now</span><b>{me.side ? `${me.avgPrice}¢ → ${me.markPrice ?? "—"}¢` : "—"}</b></div>
          <div>
            <span>Vault</span>
            <b>{usd.format(me.vault)} <em className={delta >= 0 ? "up" : "down"}>{delta >= 0 ? "+" : "−"}{usd.format(Math.abs(delta))}</em></b>
          </div>
          <div>
            <span>Standing</span>
            <b>
              {me.eliminatedRound
                ? `Out in round ${me.eliminatedRound}`
                : me.place ? `${ordinal(me.place)} of ${me.players}` : "—"}
              {above !== null && <em className={above ? "up" : "down"}>{above ? " above the cut" : " below the cut"}</em>}
            </b>
          </div>
        </div>
      )}
      {me && i.status === "live" && (
        <p className="pf-sub">
          {i.format === "royale" ? `Round ${i.roundNumber} of ${i.roundLimit} · top ${me.survivors} survive the cut`
            : i.format === "predictions" ? "Predictions · most points take the pool"
            : i.format === "streak" ? "Streak · last caller standing takes the pool"
            : "Single round · top finishers split the pool"}
          {" · "}<a href={`/a/${i.arena}`}>Open pit →</a>
        </p>
      )}
    </article>
  );
}
