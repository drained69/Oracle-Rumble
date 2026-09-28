"use client";

/**
 * ArenaStage — the Market Royale spectator view.
 *
 * Everything shown is server state (RoundView polled by ArenaView): ranks,
 * bankrolls, positions, eliminations, champion, market price, cut line.
 * Animations and feed lines are produced by diffing the previous snapshot
 * against the new one — they decide WHEN to animate, never WHAT happened.
 *
 * Cut line: `survivors` is how many alive players survive this round
 * (top N by vault value). Players ranked below it are in the danger zone.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Entrant, Round } from "@/lib/royale";
import { avatarDataUrl } from "@/lib/avatars";
import { displayName } from "@/lib/username";

type Props = {
  round: Round;
  standings: Entrant[];
  survivors: number;
  yesPrice: number;
  wallet: string | null;
};

type FeedKind = "trade" | "rank" | "cutline" | "round" | "champion" | "elim" | "info";
type FeedEvent = { id: string; at: number; text: string; kind: FeedKind };
type PodState = "winner" | "eliminated" | "below" | "line" | "safe";

type Snapshot = {
  roundId: string;
  roundNo: number;
  historyLen: number;
  survivors: number;
  ranks: Map<string, number>;
  eliminated: Set<string>;
  below: Set<string>;
  pos: Map<string, { shares: number; side: string | null; parlays: number; cashedOut: number }>;
  championAnnounced: boolean;
};

const HIGHLIGHT_MS = 1600;
const MAX_FEED = 40;
const MAX_PODS = 16;

const STATE_LABEL: Record<PodState, string> = {
  winner: "Winner",
  eliminated: "Eliminated",
  below: "Below cut",
  line: "On the line",
  safe: "Safe"
};

export default function ArenaStage({ round, standings, survivors, yesPrice, wallet }: Props) {
  const isLive = round.status === "live";
  const isComplete = round.status === "complete";
  const isCancelled = round.status === "cancelled";

  const alive = useMemo(() => standings.filter((e) => e.eliminatedRound === null), [standings]);
  const champion = useMemo(
    () => (isComplete ? standings.find((e) => e.id === round.championId) ?? standings[0] ?? null : null),
    [isComplete, standings, round.championId]
  );
  // The cut only means something while a live round has more players than survivor slots.
  const cutActive = isLive && alive.length > survivors;
  const lineBankroll = cutActive ? alive[survivors - 1]?.bankroll ?? null : null;

  const stateOf = (e: Entrant, aliveIdx: number): PodState => {
    if (champion?.id === e.id) return "winner";
    if (e.eliminatedRound !== null) return "eliminated";
    if (!cutActive) return "safe";
    if (aliveIdx >= survivors) return "below";
    if (aliveIdx === survivors - 1) return "line";
    return "safe";
  };

  // ── snapshot diff → highlights + feed ──────────────────────────────
  const prev = useRef<Snapshot | null>(null);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [rankMove, setRankMove] = useState<Record<string, "up" | "down">>({});
  const [tradePulse, setTradePulse] = useState<Record<string, "up" | "down">>({});

  useEffect(() => {
    const ranks = new Map<string, number>();
    standings.forEach((e, i) => ranks.set(e.id, i + 1));
    const eliminated = new Set(standings.filter((e) => e.eliminatedRound !== null).map((e) => e.id));
    const below = new Set(cutActive ? alive.slice(survivors).map((e) => e.id) : []);
    const pos = new Map(standings.map((e) => [e.id, {
      shares: e.shares,
      side: e.side,
      parlays: e.parlays.length,
      cashedOut: e.parlays.filter((p) => p.status === "cashed_out").length
    }] as const));
    const byId = new Map(standings.map((e) => [e.id, e] as const));
    const name = (id: string) => { const e = byId.get(id); return e ? displayName(e) : "A player"; };

    const p = prev.current;
    const events: FeedEvent[] = [];
    const t = Date.now();
    const push = (id: string, text: string, kind: FeedKind) => events.push({ id, at: t, text, kind });
    const nextRank: Record<string, "up" | "down"> = {};
    const nextPulse: Record<string, "up" | "down"> = {};

    if (!p || p.roundId !== round.id) {
      // First view of this round: seed the feed from recent server history.
      round.history.slice(-6).forEach((line, i, arr) =>
        push(`h-${round.id}-${round.history.length - arr.length + i}`, line, kindOf(line)));
    } else {
      round.history.slice(p.historyLen).forEach((line, i) =>
        push(`h-${round.id}-${p.historyLen + i}`, line, kindOf(line)));

      if (round.roundNumber !== p.roundNo) push(`round-${round.id}-${round.roundNumber}`, `Round ${round.roundNumber} begins`, "round");
      if (cutActive && survivors !== p.survivors) push(`cut-${round.id}-${survivors}-${t}`, `Top ${survivors} survive this round`, "cutline");

      eliminated.forEach((id) => { if (!p.eliminated.has(id)) push(`elim-${round.id}-${id}`, `${name(id)} was eliminated`, "elim"); });
      below.forEach((id) => { if (!p.below.has(id) && !eliminated.has(id)) push(`below-${id}-${t}`, `${name(id)} dropped below the cut`, "cutline"); });
      p.below.forEach((id) => { if (!below.has(id) && !eliminated.has(id) && ranks.has(id)) push(`above-${id}-${t}`, `${name(id)} climbed above the cut`, "rank"); });

      ranks.forEach((r, id) => {
        const before = p.ranks.get(id);
        if (!before || before === r) return;
        nextRank[id] = r < before ? "up" : "down";
        if (r === 1) push(`rank1-${id}-${t}`, `${name(id)} moved to rank #1`, "rank");
      });

      // Trades pulse the trader's pod. Keyed on position changes, not bankroll
      // (bankroll also moves with price). The feed line comes from the
      // server's own history entry, so nothing is duplicated here.
      pos.forEach((now, id) => {
        const was = p.pos.get(id);
        if (!was) return;
        const bought = now.shares > was.shares + 1e-9 && now.side;
        const parlay = now.parlays > was.parlays || now.cashedOut > was.cashedOut;
        if (bought) nextPulse[id] = now.side === "YES" ? "up" : "down";
        else if (parlay) nextPulse[id] = "up";
      });
    }

    const announce = isComplete && champion && !(p?.roundId === round.id && p.championAnnounced);
    if (announce && champion) push(`champ-${round.id}`, `${displayName(champion)} wins the arena`, "champion");

    if (events.length) {
      setFeed((f) => {
        const seen = new Set(f.map((x) => x.id));
        const fresh = events.filter((ev) => !seen.has(ev.id)).reverse();
        return [...fresh, ...f].slice(0, MAX_FEED);
      });
    }
    if (Object.keys(nextRank).length) setRankMove(nextRank);
    if (Object.keys(nextPulse).length) setTradePulse(nextPulse);

    prev.current = {
      roundId: round.id,
      roundNo: round.roundNumber,
      historyLen: round.history.length,
      survivors,
      ranks, eliminated, below, pos,
      championAnnounced: !!(announce || (p?.roundId === round.id && p.championAnnounced))
    };
  }, [standings, round, survivors, cutActive, alive, isComplete, champion]);

  // Clear transient highlights after they've played.
  useEffect(() => {
    if (!Object.keys(rankMove).length) return;
    const id = window.setTimeout(() => setRankMove({}), HIGHLIGHT_MS);
    return () => window.clearTimeout(id);
  }, [rankMove]);
  useEffect(() => {
    if (!Object.keys(tradePulse).length) return;
    const id = window.setTimeout(() => setTradePulse({}), HIGHLIGHT_MS);
    return () => window.clearTimeout(id);
  }, [tradePulse]);

  const pods = standings.slice(0, MAX_PODS);
  const hidden = standings.length - pods.length;
  const aliveIndex = new Map(alive.map((e, i) => [e.id, i] as const));
  // Radial marker between the last survivor slot and the first slot below it.
  const cutAngle = cutActive ? -90 + ((survivors - 0.5) / pods.length) * 360 : null;

  return (
    <section className="mr-stage" aria-label="Arena stage">
      <div className="mr-stage-body">
        <div className="mr-arena">
          <div className="mr-legend" aria-hidden={!cutActive && !isComplete}>
            {cutActive ? (
              <span className="mr-legend-cut">
                Top {survivors} of {alive.length} survive
                {lineBankroll != null && <> · line <b>${lineBankroll.toFixed(2)}</b></>}
              </span>
            ) : (
              <span className="mr-legend-cut muted">
                {round.status === "enrolling" ? `${standings.length}/${round.config.capacity} seats taken` :
                  isComplete ? "Final standings" : isCancelled ? "Round cancelled" : `${alive.length} alive`}
              </span>
            )}
          </div>

          <div
            className={`mr-orb ${yesPrice >= 50 ? "up" : "down"} ${isLive ? "live" : ""}`}
            role="img"
            aria-label={`Market price: YES ${yesPrice} cents, NO ${100 - yesPrice} cents`}
          >
            <div className="mr-orb-ring" aria-hidden="true" />
            <div className="mr-orb-core">
              <span className="mr-orb-q">{round.config.asset}</span>
              <span className="mr-orb-price">{yesPrice}<em>¢</em></span>
              <span className="mr-orb-sides">
                <span className="y">YES {yesPrice}¢</span>
                <span className="n">NO {100 - yesPrice}¢</span>
              </span>
            </div>
          </div>

          {cutAngle != null && (
            <div className="mr-cut-ray" style={{ transform: `rotate(${cutAngle}deg)` }} aria-hidden="true">
              <span style={{ transform: `rotate(${-cutAngle}deg)` }}>CUT</span>
            </div>
          )}

          <ol className="mr-pods" aria-label="Players by rank">
            {pods.map((e, i) => {
              const aIdx = aliveIndex.get(e.id) ?? -1;
              const state = stateOf(e, aIdx);
              const isMe = !!wallet && e.wallet === wallet;
              const pnl = e.bankroll - round.config.startingBankroll;
              const rank = i + 1;
              const cls = [
                "mr-pod", `s-${state}`, isMe ? "me" : "",
                rankMove[e.id] ? `rank-${rankMove[e.id]}` : "",
                tradePulse[e.id] ? `pulse-${tradePulse[e.id]}` : ""
              ].filter(Boolean).join(" ");
              return (
                <li
                  key={e.id}
                  className={cls}
                  style={pinFor(i, pods.length)}
                  aria-label={`Rank ${rank}, ${displayName(e)}${isMe ? " (you)" : ""}, ${STATE_LABEL[state]}, vault $${e.bankroll.toFixed(2)}, P&L ${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)}${e.side ? `, holding ${e.side}` : ""}`}
                >
                  <span className="mr-pod-rank">{state === "eliminated" ? "OUT" : `#${rank}`}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="mr-pod-avatar" src={avatarDataUrl(e.wallet, 40)} alt="" width={40} height={40} />
                  <span className="mr-pod-name">
                    {displayName(e)}
                    {isMe && <em>you</em>}
                    {e.isBot && <em className="bot">bot</em>}
                  </span>
                  <span className="mr-pod-bank">${e.bankroll.toFixed(2)}</span>
                  <span className={`mr-pod-pnl ${pnl >= 0 ? "up" : "down"}`}>{pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(2)}</span>
                  {e.side && state !== "eliminated" && (
                    <span className={`mr-pod-side ${e.side === "YES" ? "yes" : "no"}`}>{e.side === "YES" ? "▲ YES" : "▼ NO"}</span>
                  )}
                  <span className={`mr-pod-state s-${state}`}>{STATE_LABEL[state]}</span>
                </li>
              );
            })}
          </ol>

          {pods.length === 0 && (
            <p className="mr-empty" role="status">No players yet — the first seat is open.</p>
          )}
          {hidden > 0 && <p className="mr-more">+{hidden} more in standings</p>}

          {isComplete && champion && (
            <div className="mr-champ-spot" role="status">
              <div className="mr-champ-title">Champion</div>
              <div className="mr-champ-name">{displayName(champion)}</div>
              <div className="mr-champ-prize">{champion.prizeUsdc > 0 ? `+$${champion.prizeUsdc.toFixed(2)} prize` : "Last trader standing"}</div>
            </div>
          )}
          {isCancelled && (
            <div className="mr-cancelled" role="status">Round cancelled — depositors can recover their seat</div>
          )}
        </div>

        <aside className="mr-feed" aria-label="Arena activity">
          <div className="mr-feed-head">Activity</div>
          <ul className="mr-feed-list" aria-live="polite">
            {feed.length === 0 && <li className="empty">Activity appears here as players trade.</li>}
            {feed.map((ev) => (
              <li key={ev.id} className={`fe fe-${ev.kind}`}>
                <span className="fe-dot" aria-hidden="true" />
                <span className="fe-text">{ev.text}</span>
                <span className="fe-time">{ago(ev.at)}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}

/** Classify a server history line so the feed can color it. */
function kindOf(line: string): FeedKind {
  if (/bought|liquidated|parlay|cashed out/i.test(line)) return "trade";
  if (/cancelled|eliminated/i.test(line)) return "elim";
  if (/takes .* USDC/i.test(line)) return "champion";
  if (/settled|locked|opened/i.test(line)) return "round";
  return "info";
}

function ago(t: number): string {
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m`;
}

/** Even spacing on a circle, rank #1 at 12 o'clock, clockwise by rank. */
function pinFor(i: number, total: number): React.CSSProperties {
  const angle = -Math.PI / 2 + (i / Math.max(1, total)) * Math.PI * 2;
  // Flatter vertically so pods at 12 and 6 o'clock stay inside the stage.
  const rx = 40, ry = 33;
  return { left: `${50 + Math.cos(angle) * rx}%`, top: `${50 + Math.sin(angle) * ry}%` };
}
