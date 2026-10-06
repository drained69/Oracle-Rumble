"use client";

/**
 * PitTerminal — the market panel of a trading pit: the price tape, where the
 * room's money sits, and the Oracle read. Everything is public pit state;
 * positioning appears only once the round is live (opening calls stay hidden
 * while enrolling).
 */

import { useEffect, useState } from "react";
import OddsChart from "@/app/OddsChart";
import { closingWindowMs } from "@/lib/room-book";
import type { Entrant, Round } from "@/lib/royale";

type Read = {
  tilt: "YES" | "NO" | "neutral";
  tiltLabel: string;
  confidence: "low" | "medium" | "high";
  headline: string;
  chips: { k: string; v: string; tone: "up" | "down" | "flat" }[];
  source: "claude" | "signals";
  at: number;
};

export default function PitTerminal({ arenaCode, round, standings, yesPrice, line, now }: {
  arenaCode: string;
  round: Round;
  standings: Entrant[];
  yesPrice: number;
  line: number | null;
  now: number;
}) {
  const panta = round.config.marketSource === "panta";
  const Y = panta ? "YES" : "UP";
  const N = panta ? "NO" : "DOWN";
  const live = round.status === "live";
  const started = round.status !== "enrolling" && round.status !== "cancelled";

  // ── Oracle read (shared, cached server-side ~20s) ─────────────────
  const [read, setRead] = useState<Read | null>(null);
  const [readErr, setReadErr] = useState("");
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/round/read?arena=${encodeURIComponent(arenaCode)}`, { cache: "no-store" });
        const j = await r.json();
        if (stop) return;
        if (r.ok) { setRead(j as Read); setReadErr(""); } else setReadErr(j.error ?? "Read unavailable.");
      } catch { if (!stop) setReadErr("Read unavailable right now."); }
    };
    load();
    const id = window.setInterval(load, live ? 20_000 : 60_000);
    return () => { stop = true; window.clearInterval(id); };
  }, [arenaCode, live, round.id, round.status]);

  // ── where the room's money sits (live only) ──────────────────────
  let yesVal = 0, noVal = 0, longYes = 0, longNo = 0, flat = 0;
  if (started) {
    for (const e of standings) {
      if (e.eliminatedRound !== null) continue;
      if (e.side === "YES" && e.shares > 0) { longYes++; yesVal += e.shares * (yesPrice / 100); }
      else if (e.side === "NO" && e.shares > 0) { longNo++; noVal += e.shares * ((100 - yesPrice) / 100); }
      else flat++;
    }
  }
  const positioned = yesVal + noVal;
  const yesShare = positioned > 0 ? yesVal / positioned : null;

  const from = round.tape?.[0]?.[0] ?? (round.liveDeadline ? round.liveDeadline - round.config.liveSec * 1000 : now);
  const to = round.liveDeadline || from + round.config.liveSec * 1000;
  const closingFrom = panta ? to - closingWindowMs(round.config.liveSec) : null;

  return (
    <section className="pit-terminal" aria-label="Market terminal">
      <div className="pt-chart">
        {started && (round.tape?.length ?? 0) > 0 ? (
          <OddsChart
            tape={round.tape ?? []}
            label={panta ? "Room YES price" : `${round.config.asset} UP price`}
            reference={panta ? line : null}
            from={from}
            to={to}
            closingFrom={closingFrom}
            now={now}
          />
        ) : (
          <div className="pt-empty">
            <b>{panta ? `Opening line ${line !== null ? `${Math.round(line)}¢ YES` : "from Panta"}` : "The tape starts when trading opens"}</b>
            <p>{panta
              ? "When enrollment locks, every seat call fills at Panta's line and the room trades its own odds from there."
              : "Every pit records its price as it trades — the chart fills in from the open to the bell."}</p>
          </div>
        )}
      </div>

      <div className="pt-side">
        <div className="pt-block">
          <div className="pt-k">Where the room&apos;s money sits</div>
          {yesShare === null ? (
            <p className="pt-muted">{started ? "Nobody holds a position yet." : "Hidden until trading opens — seat calls stay secret while the pit fills."}</p>
          ) : (
            <>
              <div className="pt-lean" role="img" aria-label={`${Math.round(yesShare * 100)}% of positioned money on ${Y}, ${Math.round((1 - yesShare) * 100)}% on ${N}`}>
                <span className="y" style={{ width: `${Math.max(2, yesShare * 100)}%` }} />
                <span className="n" style={{ width: `${Math.max(2, (1 - yesShare) * 100)}%` }} />
              </div>
              <div className="pt-lean-legend">
                <span><i className="y" aria-hidden="true" />{Y} {Math.round(yesShare * 100)}% · {longYes} player{longYes === 1 ? "" : "s"}</span>
                <span><i className="n" aria-hidden="true" />{N} {Math.round((1 - yesShare) * 100)}% · {longNo}</span>
              </div>
              {flat > 0 && <p className="pt-muted">{flat} in cash</p>}
            </>
          )}
        </div>

        <div className="pt-block oracle">
          <div className="pt-k">
            Oracle read
            {read && <span className={`pt-badge ${read.source}`}>{read.source === "claude" ? "AI · Claude" : "from market data"}</span>}
          </div>
          {read ? (
            <>
              <p className="pt-headline">{read.headline}</p>
              <div className="pt-tilt">
                <span className={`pt-lean-chip ${read.tilt === "YES" ? "up" : read.tilt === "NO" ? "down" : ""}`}>
                  Lean {read.tiltLabel}
                </span>
                <span className="pt-conf">{read.confidence} confidence</span>
              </div>
              {read.chips.length > 0 && (
                <dl className="pt-chips">
                  {read.chips.map((c) => {
                    // The read is cached; the clock chip ticks locally instead.
                    const s = Math.max(0, Math.floor((round.liveDeadline - now) / 1000));
                    const v = c.k === "Bell" && live ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : c.v;
                    return <div key={c.k}><dt>{c.k}</dt><dd className={c.tone}>{v}</dd></div>;
                  })}
                </dl>
              )}
              <p className="pt-fine">A read of the pit&apos;s own data — price, flow, Panta&apos;s line and the clock. Not advice.</p>
            </>
          ) : (
            <p className="pt-muted">{readErr || "Reading the market…"}</p>
          )}
        </div>
      </div>
    </section>
  );
}
