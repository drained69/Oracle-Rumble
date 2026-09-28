"use client";

/**
 * ArenaStage — the "Market Royale" spectator dashboard.
 *
 * Rendered above the trade controls inside ArenaView. Reads the LIVE
 * round state (entrants, standings, market, prize pool, cut line, status)
 * and turns it into a visual battle royale: player pods orbiting a central
 * market orb, animating only from real state deltas.
 *
 * What is real vs. what is animation:
 *   - Bankrolls, P&L, ranks, alive/eliminated, market price, prize pool,
 *     champion, elimination line → all come from server state (RoundView).
 *   - Animations (rank-move highlight, buy pulse, elimination sweep,
 *     champion spotlight, activity feed lines) are triggered by DIFFING
 *     the last-seen state against the new state. Nothing is fabricated.
 *
 * Accessibility: every color state carries a text label; motion is gated
 * on prefers-reduced-motion.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Entrant, Round } from "@/lib/royale";
import { avatarDataUrl } from "@/lib/avatars";
import { displayName } from "@/lib/username";

type Props = {
  round: Round;
  standings: Entrant[];
  cut: number;
  yesPrice: number;
  wallet: string | null;
};

// A local event surfaced in the activity feed. Derived from real state.
type FeedEvent = {
  id: string;    // stable key
  at: number;    // ms
  text: string;
  kind: "trade" | "rank" | "cutline" | "round" | "champion" | "elim" | "info";
};

const CUT_DANGER_ABS = 2;        // within $2 of the cut line → danger
const RANK_HIGHLIGHT_MS = 1600;   // rank-move highlight duration
const BUY_PULSE_MS = 1200;
const MAX_FEED_ITEMS = 40;

export default function ArenaStage({ round, standings, cut, yesPrice, wallet }: Props) {
  const alive = useMemo(() => standings.filter((e) => e.eliminatedRound === null), [standings]);
  const dead = useMemo(() => standings.filter((e) => e.eliminatedRound !== null), [standings]);
  const totalCount = standings.length;
  const isComplete = round.status === "complete";
  const isCancelled = round.status === "cancelled";
  const isLive = round.status === "live";

  // Champion = server-declared (round.championId) or top rank at complete.
  const champion = useMemo(() => {
    if (!isComplete) return null;
    return standings.find((e) => e.id === round.championId) ?? standings[0] ?? null;
  }, [isComplete, standings, round.championId]);

  // ── event diff → activity feed ────────────────────────────────────
  // Track prior view so we can emit derived events (rank moves, buys,
  // eliminations). server-side round.history entries are also mirrored.
  const prevRef = useRef<{
    ranks: Map<string, number>;
    bankrolls: Map<string, number>;
    eliminated: Set<string>;
    historyLen: number;
    cut: number;
    roundNo: number;
  } | null>(null);

  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [rankHighlights, setRankHighlights] = useState<Map<string, "up" | "down">>(new Map());
  const [buyPulses, setBuyPulses] = useState<Set<string>>(new Set());

  useEffect(() => {
    const prev = prevRef.current;
    const currentRanks = new Map<string, number>();
    // Rank is standings order for live/enrolling; for complete it's e.rank.
    standings.forEach((e, i) => currentRanks.set(e.id, isComplete ? (e.rank ?? i + 1) : i + 1));

    const currentBankrolls = new Map(standings.map((e) => [e.id, e.bankroll] as const));
    const currentEliminated = new Set(dead.map((e) => e.id));

    const newEvents: FeedEvent[] = [];

    // Mirror any new server-emitted history entries.
    if (prev && round.history.length > prev.historyLen) {
      const fresh = round.history.slice(prev.historyLen);
      fresh.forEach((line, i) =>
        newEvents.push({
          id: `h-${round.id}-${prev.historyLen + i}`,
          at: Date.now(),
          text: line,
          kind: "info"
        })
      );
    }

    if (prev) {
      // Round bumped?
      if (round.roundNumber !== prev.roundNo) {
        newEvents.push({
          id: `round-${round.id}-${round.roundNumber}`,
          at: Date.now(),
          text: `Round ${round.roundNumber} begins`,
          kind: "round"
        });
      }
      // Cut line moved?
      if (cut && cut !== prev.cut) {
        newEvents.push({
          id: `cut-${round.id}-${cut.toFixed(2)}`,
          at: Date.now(),
          text: `Elimination line moved to $${cut.toFixed(2)}`,
          kind: "cutline"
        });
      }
      // New eliminations?
      currentEliminated.forEach((id) => {
        if (!prev.eliminated.has(id)) {
          const e = standings.find((x) => x.id === id);
          if (e) {
            newEvents.push({
              id: `elim-${round.id}-${e.id}`,
              at: Date.now(),
              text: `${displayName(e)} eliminated`,
              kind: "elim"
            });
          }
        }
      });
      // Rank changes → highlight per-entrant + feed for #1 moves.
      const nextHighlights = new Map<string, "up" | "down">();
      currentRanks.forEach((r, id) => {
        const before = prev.ranks.get(id);
        if (before && before !== r) {
          nextHighlights.set(id, r < before ? "up" : "down");
          if (r === 1 && before !== 1) {
            const e = standings.find((x) => x.id === id);
            if (e) newEvents.push({
              id: `rank1-${round.id}-${e.id}-${Date.now()}`,
              at: Date.now(),
              text: `${displayName(e)} moved to rank #1`,
              kind: "rank"
            });
          }
        }
      });
      if (nextHighlights.size > 0) {
        setRankHighlights(nextHighlights);
        const t = window.setTimeout(() => setRankHighlights(new Map()), RANK_HIGHLIGHT_MS);
        // best-effort cleanup on next diff
        return () => window.clearTimeout(t);
      }
      // Buy detection: bankroll delta + side set + non-eliminated.
      const nextPulses = new Set<string>();
      currentBankrolls.forEach((br, id) => {
        const before = prev.bankrolls.get(id);
        const e = standings.find((x) => x.id === id);
        if (!e || e.eliminatedRound !== null) return;
        if (before === undefined) return;
        // Trade emits a bankroll change (mark-to-market + fees) — use a
        // sensible threshold so pure MtM ticks don't fire pulses.
        if (Math.abs(br - before) >= 0.25 && e.side) {
          nextPulses.add(id);
          newEvents.push({
            id: `buy-${round.id}-${e.id}-${Date.now()}`,
            at: Date.now(),
            text: `${displayName(e)} bought ${e.side}`,
            kind: "trade"
          });
        }
      });
      if (nextPulses.size > 0) {
        setBuyPulses(nextPulses);
        window.setTimeout(() => setBuyPulses(new Set()), BUY_PULSE_MS);
      }
      // Champion announcement (only once per round transition).
      if (isComplete && !prev) {
        // handled below in the "no prev" branch
      } else if (isComplete && champion && !prev.ranks.has(champion.id)) {
        // shouldn't happen; ignore
      }
      if (isComplete && champion) {
        const alreadyLogged = feed.some((f) => f.id === `champ-${round.id}`);
        if (!alreadyLogged) {
          newEvents.push({
            id: `champ-${round.id}`,
            at: Date.now(),
            text: `${displayName(champion)} wins the arena`,
            kind: "champion"
          });
        }
      }
    }

    if (newEvents.length > 0) {
      setFeed((f) => {
        const seen = new Set(f.map((x) => x.id));
        const merged = [...f];
        for (const ev of newEvents) if (!seen.has(ev.id)) merged.unshift(ev);
        return merged.slice(0, MAX_FEED_ITEMS);
      });
    }

    prevRef.current = {
      ranks: currentRanks,
      bankrolls: currentBankrolls,
      eliminated: currentEliminated,
      historyLen: round.history.length,
      cut,
      roundNo: round.roundNumber
    };
    // We intentionally exclude `feed` from deps — it's a sink, not a source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standings, round.history.length, round.roundNumber, round.status, cut, isComplete, champion?.id, round.id, dead]);

  // ── layout ─────────────────────────────────────────────────────────
  // Show up to 16 pods around the orb. If more, alive first, then the
  // most recently eliminated. Everything is deterministic based on rank.
  const displayEntrants = useMemo(() => {
    const list = isComplete ? standings : [...alive, ...dead.slice(0, Math.max(0, 16 - alive.length))];
    return list.slice(0, 16);
  }, [alive, dead, standings, isComplete]);

  return (
    <section className="mr-stage" aria-label="Arena stage">
      {/* Status strip: round · timer · market · price · pool · alive */}
      <div className="mr-strip">
        <div>
          <span className="k">Round</span>
          <span className="v">
            {round.roundNumber}<em>/{round.config.roundLimit}</em>
          </span>
        </div>
        <div>
          <span className="k">Status</span>
          <span className={`v status ${round.status}`}>{stateLabel(round.status)}</span>
        </div>
        <div>
          <span className="k">Prize pool</span>
          <span className="v plasma">${round.prizePoolUsdc.toFixed(2)}</span>
        </div>
        <div>
          <span className="k">Alive</span>
          <span className="v">
            {alive.length}<em>/{totalCount}</em>
          </span>
        </div>
        <div>
          <span className="k">Cut line</span>
          <span className="v danger">
            {cut > 0 ? `$${cut.toFixed(2)}` : "—"}
          </span>
        </div>
        <div className="grow">
          <span className="k">Market · {round.config.asset}</span>
          <span className="v market">{round.config.marketQuestion}</span>
        </div>
      </div>

      <div className="mr-stage-body">
        <div className="mr-arena" role="group" aria-label="Player pods">
          {/* Central market orb */}
          <div
            className={`mr-orb ${yesPrice >= 50 ? "up" : "down"} ${isLive ? "live" : ""}`}
            aria-label={`Market YES ${yesPrice} cents, NO ${100 - yesPrice} cents`}
          >
            <div className="mr-orb-ring" aria-hidden="true" />
            <div className="mr-orb-core">
              <span className="mr-orb-side">{yesPrice >= 50 ? "▲ YES" : "▼ NO"}</span>
              <span className="mr-orb-price">{yesPrice}<em>¢</em></span>
              <span className="mr-orb-side-alt">{yesPrice >= 50 ? `NO ${100 - yesPrice}¢` : `YES ${yesPrice}¢`}</span>
            </div>
          </div>

          {/* Player pods, positioned around the orb */}
          <div className="mr-pods">
            {displayEntrants.map((e, i) => {
              const rank = isComplete ? (e.rank ?? i + 1) : i + 1;
              const isMe = e.wallet === wallet;
              const isDead = e.eliminatedRound !== null;
              const isWinner = isComplete && champion?.id === e.id;
              const isDanger = !isDead && !isWinner && cut > 0 && e.bankroll <= cut + CUT_DANGER_ABS;
              const pulse = buyPulses.has(e.id);
              const rankHi = rankHighlights.get(e.id) ?? null;
              const pnl = e.bankroll - (round.config.startingBankroll ?? 0);

              const stateLabelText = isWinner
                ? "Winner"
                : isDead
                ? `Eliminated R${e.eliminatedRound}`
                : isDanger
                ? "Danger"
                : "Alive";

              return (
                <div
                  key={e.id}
                  className={[
                    "mr-pod",
                    isMe ? "me" : "",
                    isDead ? "dead" : "",
                    isDanger ? "danger" : "",
                    isWinner ? "winner" : "",
                    pulse ? `pulse-${e.side === "YES" ? "up" : "down"}` : "",
                    rankHi ? `rank-${rankHi}` : ""
                  ].filter(Boolean).join(" ")}
                  style={pinFor(i, displayEntrants.length)}
                  aria-label={`${displayName(e)}, rank ${rank}, ${stateLabelText}, bankroll $${e.bankroll.toFixed(2)}`}
                >
                  <div className="mr-pod-rank">#{rank}</div>
                  <img
                    className="mr-pod-avatar"
                    src={avatarDataUrl(e.id)}
                    alt=""
                    width={44}
                    height={44}
                  />
                  <div className="mr-pod-name">
                    {displayName(e)}
                    {isMe && <em>you</em>}
                  </div>
                  <div className="mr-pod-bank">${e.bankroll.toFixed(2)}</div>
                  <div className={`mr-pod-pnl ${pnl >= 0 ? "up" : "down"}`}>
                    {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                  </div>
                  <div className={`mr-pod-state ${isWinner ? "winner" : isDead ? "dead" : isDanger ? "danger" : "alive"}`}>
                    {stateLabelText}
                  </div>
                </div>
              );
            })}
            {displayEntrants.length === 0 && (
              <div className="mr-empty" role="status">
                Waiting for the first player to sit down…
              </div>
            )}
          </div>

          {/* Elimination line — a visual marker between "safe" and "danger" */}
          {isLive && cut > 0 && (
            <div className="mr-cutline" aria-hidden="true">
              <span>CUT ${cut.toFixed(2)}</span>
            </div>
          )}

          {/* Champion spotlight */}
          {isComplete && champion && (
            <div className="mr-champ-spot" role="status" aria-label={`${displayName(champion)} wins`}>
              <div className="mr-champ-title">CHAMPION</div>
              <div className="mr-champ-name">{displayName(champion)}</div>
              <div className="mr-champ-prize">${champion.prizeUsdc.toFixed(2)}</div>
            </div>
          )}

          {isCancelled && (
            <div className="mr-cancelled" role="status">Rumble cancelled — recoveries open</div>
          )}
        </div>

        {/* Activity feed — real events, freshest at the top */}
        <aside className="mr-feed" aria-label="Activity">
          <div className="mr-feed-head">Activity</div>
          <ul className="mr-feed-list">
            {feed.length === 0 && <li className="empty">Waiting for the first move…</li>}
            {feed.map((ev) => (
              <li key={ev.id} className={`fe fe-${ev.kind}`}>
                <span className="fe-dot" aria-hidden="true" />
                <span className="fe-text">{ev.text}</span>
                <span className="fe-time" aria-hidden="true">{ago(ev.at)}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}

// ── helpers ────────────────────────────────────────────────────────

function stateLabel(s: Round["status"]): string {
  switch (s) {
    case "enrolling": return "Enrolling";
    case "live":      return "Live";
    case "settling":  return "Settling";
    case "advancing": return "Advancing";
    case "complete":  return "Complete";
    case "cancelled": return "Cancelled";
  }
}

function ago(t: number): string {
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m`;
}

/**
 * Compute a pod's absolute position around the market orb. Even distribution
 * on a circle whose radius scales with pod count. Purely visual — index i
 * comes from the standings order so a rank move looks like the pod
 * traveling to its new spot.
 */
function pinFor(i: number, total: number): React.CSSProperties {
  const n = Math.max(1, total);
  // Start at the top and go clockwise so rank #1 sits at 12 o'clock.
  const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
  // Radius in % so it scales with container. Two rings if too many pods.
  const ring = i >= 12 ? 1 : 0;
  const r = ring === 0 ? 38 : 46;
  const x = 50 + Math.cos(angle) * r;
  const y = 50 + Math.sin(angle) * r;
  return {
    left: `${x}%`,
    top: `${y}%`,
    transform: "translate(-50%, -50%)"
  };
}
