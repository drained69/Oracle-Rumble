"use client";

/**
 * PitOverlay — a pit on a stream. Read-only and wallet-free: the market, the
 * live odds, the pool and clock, the top of the board, and a QR to join.
 * Polls the same public endpoint as the pit page, so hidden seat calls stay
 * hidden here too.
 */

import { useEffect, useMemo, useState } from "react";
import { BrandMark } from "@/app/BrandMark";
import type { Entrant, Round } from "@/lib/royale";
import { displayName } from "@/lib/username";

type View = { round: Round | null; yesPrice: number; line?: number | null; standings: Entrant[]; error?: string };

const usd = (n: number) => `$${n.toFixed(2)}`;
function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function PitOverlay({ arenaCode, solid }: { arenaCode: string; solid: boolean }) {
  const [view, setView] = useState<View | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [qr, setQr] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    document.body.classList.add("overlay-mode");
    if (solid) document.body.classList.add("overlay-solid");
    setOrigin(window.location.origin);
    return () => document.body.classList.remove("overlay-mode", "overlay-solid");
  }, [solid]);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/round?arena=${encodeURIComponent(arenaCode)}`, { cache: "no-store" });
        const j = (await r.json()) as View;
        if (!stop) setView(j);
      } catch { /* keep the last frame on a blip */ }
    };
    load();
    const id = window.setInterval(load, 3000);
    const tick = window.setInterval(() => setNow(Date.now()), 500);
    return () => { stop = true; window.clearInterval(id); window.clearInterval(tick); };
  }, [arenaCode]);

  const joinUrl = origin ? `${origin}/a/${arenaCode}` : "";
  useEffect(() => {
    if (!joinUrl) return;
    import("qrcode").then((Q) => Q.toString(joinUrl, { type: "svg", margin: 1, color: { dark: "#0b0e17", light: "#edf0f6" } }))
      .then(setQr).catch(() => { /* optional */ });
  }, [joinUrl]);

  const round = view?.round ?? null;
  const panta = round?.config.marketSource === "panta";
  const Y = panta ? "YES" : "UP";
  const N = panta ? "NO" : "DOWN";
  const yes = Math.round(round?.book?.close ?? view?.yesPrice ?? 50);
  const final = round?.status === "complete";
  const top = useMemo(() => (view?.standings ?? []).filter((e) => final || e.eliminatedRound === null).slice(0, 5), [view?.standings, final]);
  const alive = (view?.standings ?? []).filter((e) => e.eliminatedRound === null).length;
  const deadline = round?.status === "enrolling" ? round.enrollDeadline : round?.status === "live" ? round.liveDeadline : 0;
  const spark = useMemo(() => {
    const tape = round?.tape ?? [];
    if (tape.length < 2) return "";
    const t0 = tape[0][0], t1 = Math.max(tape[tape.length - 1][0], t0 + 1);
    return tape.map(([t, v], i) => `${i ? "L" : "M"}${(((t - t0) / (t1 - t0)) * 300).toFixed(1)},${(60 - (v / 100) * 60).toFixed(1)}`).join("");
  }, [round?.tape]);

  if (!round) {
    return (
      <main className="ov">
        <div className="ov-card ov-wait"><BrandMark size={28} /> <span>{view?.error ? `Pit ${arenaCode} isn't open` : `Connecting to pit ${arenaCode}…`}</span></div>
      </main>
    );
  }

  const status = round.status === "enrolling" ? "Seats open" : round.status === "live" ? "Live" : round.status === "complete" ? "Final" : round.status === "cancelled" ? "Closed" : "Settling";

  return (
    <main className="ov">
      <div className="ov-card">
        <div className="ov-top">
          <span className="ov-brand"><BrandMark size={26} /> THE PIT</span>
          <span className="ov-code">PIT {arenaCode}</span>
          <span className={`ov-status s-${round.status}`}>{status}{deadline ? ` · ${clock(deadline - now)}` : ""}</span>
        </div>

        <div className="ov-q">{round.config.marketQuestion}</div>

        <div className="ov-odds" role="img" aria-label={`${Y} ${yes} cents, ${N} ${100 - yes} cents`}>
          <div className="ov-bar">
            <span className="y" style={{ width: `${yes}%` }}><b>{Y} {yes}¢</b></span>
            <span className="n" style={{ width: `${100 - yes}%` }}><b>{N} {100 - yes}¢</b></span>
          </div>
          {spark && (
            <svg className="ov-spark" viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden="true">
              <path d={spark} fill="none" stroke="#0ea5c4" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            </svg>
          )}
          {panta && view?.line != null && <span className="ov-line">Panta line {Math.round(view.line)}¢ · room {yes - Math.round(view.line) >= 0 ? "+" : "−"}{Math.abs(yes - Math.round(view.line))}¢</span>}
        </div>

        <div className="ov-grid">
          <div className="ov-board">
            <div className="ov-k">{final ? "Final standings" : `Top of the pit · ${alive} in`}</div>
            <ol>
              {top.map((e, i) => (
                <li key={e.id}>
                  <span className="r">#{i + 1}</span>
                  <span className="nm">{displayName(e)}</span>
                  {e.side && e.shares > 0 && <span className={`sd ${e.side === "YES" ? "y" : "n"}`}>{e.side === "YES" ? Y : N}</span>}
                  <span className="v">{usd(e.bankroll)}</span>
                </li>
              ))}
              {top.length === 0 && <li className="empty">Waiting for the first seat</li>}
            </ol>
          </div>
          <div className="ov-join">
            <div className="ov-k">Pool</div>
            <div className="ov-pool">{usd(round.prizePoolUsdc)}</div>
            {round.status === "enrolling" && (
              <div className="ov-qr">
                {qr && <span dangerouslySetInnerHTML={{ __html: qr }} />}
                <span className="ov-join-t">Scan to join<br /><b>{arenaCode}</b></span>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
