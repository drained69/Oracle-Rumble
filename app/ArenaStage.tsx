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
import { paidPlaces, scorePlace, type Entrant, type Round } from "@/lib/royale";
import { changeOf } from "@/lib/predictions";
import { avatarDataUrl } from "@/lib/avatars";
import { displayName } from "@/lib/username";

type Props = {
  round: Round;
  standings: Entrant[];
  survivors: number;
  yesPrice: number;
  /** Latest USD spot price of the round's asset (oracle), if known. */
  spot?: number | null;
  wallet: string | null;
};

type FeedKind = "trade" | "rank" | "cutline" | "round" | "champion" | "elim" | "info";
type FeedEvent = { id: string; at: number; text: string; kind: FeedKind };
type PodState = "winner" | "eliminated" | "below" | "line" | "safe" | "ready" | "picking" | "money" | "nomoney" | "bot";

type Snapshot = {
  roundId: string;
  roundNo: number;
  historyLen: number;
  survivors: number;
  ranks: Map<string, number>;
  eliminated: Set<string>;
  below: Set<string>;
  pos: Map<string, { shares: number; side: string | null }>;
};

const HIGHLIGHT_MS = 1600;
const THROTTLE_MS = 20_000;
const MAX_FEED = 40;
const MAX_PODS = 16;

const STATE_LABEL: Record<PodState, string> = {
  winner: "Winner",
  eliminated: "Eliminated",
  below: "Below cut",
  line: "On the line",
  safe: "Safe",
  ready: "Ready",
  picking: "Picking",
  money: "In the money",
  nomoney: "Out of the money",
  bot: "Bot"
};

export default function ArenaStage({ round, standings, survivors, yesPrice, spot, wallet }: Props) {
  const isLive = round.status === "live";
  const isComplete = round.status === "complete";
  const isCancelled = round.status === "cancelled";

  const alive = useMemo(() => standings.filter((e) => e.eliminatedRound === null), [standings]);
  const champion = useMemo(
    () => (isComplete ? standings.find((e) => e.id === round.championId) ?? standings[0] ?? null : null),
    [isComplete, standings, round.championId]
  );
  // A single round has no elimination that matters — only who gets paid —
  // so it shows prize places; a royale shows its survival cut. Predictions
  // is a single round scored on right answers.
  const picks = round.config.format === "predictions";
  const single = round.config.format !== "royale";
  const totalQs = round.predictions?.questions.length ?? 0;
  // The cut only means something while a live round has more players than survivor slots.
  const cutActive = !single && isLive && alive.length > survivors;
  const lineBankroll = cutActive ? alive[survivors - 1]?.bankroll ?? null : null;
  const places = paidPlaces(round);
  const humanRank = useMemo(() => new Map(standings.filter((e) => !e.isBot).map((e, i) => [e.id, i] as const)), [standings]);

  const stateOf = (e: Entrant, aliveIdx: number): PodState => {
    if (champion?.id === e.id) return "winner";
    if (round.status === "enrolling") return picks && Object.keys(e.picks ?? {}).length < totalQs ? "picking" : "ready";
    if (picks && isLive) return e.isBot ? "bot" : scorePlace(round, e, true) <= places ? "money" : "nomoney";
    if (picks && isComplete) return e.isBot ? "bot" : e.prizeUsdc > 0 ? "money" : "nomoney";
    if (single && isLive) return e.isBot ? "bot" : (humanRank.get(e.id) ?? 99) < places ? "money" : "nomoney";
    if (e.eliminatedRound !== null) return "eliminated";
    if (!cutActive) return "safe";
    if (aliveIdx >= survivors) return "below";
    if (aliveIdx === survivors - 1) return "line";
    return "safe";
  };

  // ── snapshot diff → highlights + feed ──────────────────────────────
  const prev = useRef<Snapshot | null>(null);
  // Last time each derived line (rank/cut change) was posted, to keep a
  // lead that flips back and forth from flooding the feed.
  const lastPosted = useRef<Map<string, number>>(new Map());
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [rankMove, setRankMove] = useState<Record<string, "up" | "down">>({});
  const [tradePulse, setTradePulse] = useState<Record<string, "up" | "down">>({});

  useEffect(() => {
    const ranks = new Map<string, number>();
    standings.forEach((e, i) => ranks.set(e.id, i + 1));
    const eliminated = new Set(standings.filter((e) => e.eliminatedRound !== null).map((e) => e.id));
    const below = new Set(cutActive ? alive.slice(survivors).map((e) => e.id) : []);
    const pos = new Map(standings.map((e) => [e.id, { shares: e.shares, side: e.side }] as const));
    const byId = new Map(standings.map((e) => [e.id, e] as const));
    const name = (id: string) => { const e = byId.get(id); return e ? displayName(e) : "A player"; };

    const p = prev.current;
    const events: FeedEvent[] = [];
    const t = Date.now();
    // Server log lines carry the time they happened; 0 = not recorded.
    const loggedAt = (i: number) => round.historyAt?.[i] ?? 0;
    const lastLogged = (re: RegExp) => {
      for (let i = round.history.length - 1; i >= 0; i--) if (re.test(round.history[i])) return loggedAt(i);
      return 0;
    };
    const push = (id: string, text: string, kind: FeedKind, at = t) => events.push({ id, at, text, kind });
    const nextRank: Record<string, "up" | "down"> = {};
    const nextPulse: Record<string, "up" | "down"> = {};

    if (!p || p.roundId !== round.id) {
      // First view of this round: seed the feed from recent server history.
      const from = Math.max(0, round.history.length - 8);
      round.history.slice(from).forEach((line, i) =>
        push(`h-${round.id}-${from + i}`, line, kindOf(line), loggedAt(from + i)));
    } else {
      round.history.slice(p.historyLen).forEach((line, i) =>
        push(`h-${round.id}-${p.historyLen + i}`, line, kindOf(line), loggedAt(p.historyLen + i) || t));

      if (round.roundNumber !== p.roundNo) push(`round-${round.id}-${round.roundNumber}`, `Round ${round.roundNumber} begins`, "round", round.createdAt || t);
      if (cutActive && survivors !== p.survivors) push(`cut-${round.id}-${survivors}-${t}`, `Top ${survivors} survive this round`, "cutline");

      const settledAt = lastLogged(/ settled/) || t;
      eliminated.forEach((id) => { if (!p.eliminated.has(id)) push(`elim-${round.id}-${id}`, `${name(id)} was eliminated`, "elim", settledAt); });
      // Rank/cut changes: one line per player, and the same line at most
      // once every THROTTLE_MS. With a single survivor slot "above the cut"
      // just means "#1", so only the #1 line is posted.
      const throttled = (key: string) => {
        const last = lastPosted.current.get(key) ?? 0;
        if (t - last < THROTTLE_MS) return true;
        lastPosted.current.set(key, t);
        return false;
      };
      ranks.forEach((r, id) => {
        const before = p.ranks.get(id);
        if (before && before !== r) nextRank[id] = r < before ? "up" : "down";
      });
      const newLeader = isLive ? [...ranks].find(([id, r]) => r === 1 && (p.ranks.get(id) ?? 1) !== 1)?.[0] : undefined;
      if (newLeader && !eliminated.has(newLeader) && !throttled(`lead-${newLeader}`)) {
        push(`rank1-${newLeader}-${t}`, `${name(newLeader)} took the lead`, "rank");
      }
      if (survivors > 1 && !single) {
        below.forEach((id) => {
          if (!p.below.has(id) && !eliminated.has(id) && !throttled(`below-${id}`)) push(`below-${id}-${t}`, `${name(id)} dropped below the cut`, "cutline");
        });
        p.below.forEach((id) => {
          if (!below.has(id) && !eliminated.has(id) && ranks.has(id) && id !== newLeader && !throttled(`above-${id}`)) push(`above-${id}-${t}`, `${name(id)} climbed above the cut`, "rank");
        });
      }

      // Trades pulse the trader's pod. Keyed on position changes, not bankroll
      // (bankroll also moves with price). The feed line comes from the
      // server's own history entry, so nothing is duplicated here.
      pos.forEach((now, id) => {
        const was = p.pos.get(id);
        if (!was) return;
        const bought = now.shares > was.shares + 1e-9 && now.side;
        if (bought) nextPulse[id] = now.side === "YES" ? "up" : "down";
      });
    }

    if (events.length) {
      setFeed((f) => {
        const seen = new Set(f.map((x) => x.id));
        const fresh = events.filter((ev) => !seen.has(ev.id)).reverse();
        // Newest first by when it happened; lines with no recorded time
        // (older rounds) keep their order below the timed ones.
        return [...fresh, ...f].sort((a, b) => b.at - a.at).slice(0, MAX_FEED);
      });
    }
    if (Object.keys(nextRank).length) setRankMove(nextRank);
    if (Object.keys(nextPulse).length) setTradePulse(nextPulse);

    prev.current = {
      roundId: round.id,
      roundNo: round.roundNumber,
      historyLen: round.history.length,
      survivors,
      ranks, eliminated, below, pos
    };
  }, [standings, round, survivors, cutActive, alive, isLive]);

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

  // Oracle view of the asset: open / close from the round, live spot from the poll.
  const asset = round.config.asset;
  const open = round.oracle?.open?.[asset];
  const close = round.oracle?.close?.[asset];
  const closed = !!close;
  const shown = close ?? spot ?? round.oracle?.last?.[asset] ?? null;
  const move = open && shown ? ((shown - open) / open) * 100 : null;

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
            ) : single && isLive ? (
              <span className="mr-legend-cut">{places === 1 ? "Winner takes the pool" : `Top ${places} players split the pool`}</span>
            ) : (
              <span className="mr-legend-cut muted">
                {round.status === "enrolling" ? `${standings.length}/${round.config.capacity} seats taken` :
                  isComplete ? "Final standings" : isCancelled ? "Round cancelled" : `${alive.length} alive`}
              </span>
            )}
          </div>

          {picks ? (
            <div className={`mr-orb picks ${isLive ? "live" : ""}`} role="img" aria-label={coinsLabel(round)}>
              <div className="mr-orb-ring" aria-hidden="true" />
              <div className="mr-orb-core">
                <span className="mr-orb-q">{closed ? "Closing moves" : round.oracle?.open ? "Moves vs open" : "Predictions"}</span>
                {round.oracle?.open ? (
                  <span className="mr-orb-coins">
                    {(["BTC", "ETH", "SOL"] as const).map((a) => {
                      const c = changeOf(round.oracle?.open?.[a], (round.oracle?.close ?? round.oracle?.last)?.[a]);
                      return (
                        <span key={a} className={c === null ? "" : c > 0 ? "up" : c < 0 ? "down" : ""}>
                          <b>{a}</b> {c === null ? "—" : `${c > 0 ? "▲" : c < 0 ? "▼" : "•"} ${Math.abs(c * 100).toFixed(2)}%`}
                        </span>
                      );
                    })}
                  </span>
                ) : (
                  <span className="mr-orb-move">{totalQs} picks · BTC ETH SOL</span>
                )}
                <span className="mr-orb-move">{round.status === "enrolling" ? "prices lock at the start" : isLive ? "most right answers wins" : ""}</span>
              </div>
            </div>
          ) : (
          <div
            className={`mr-orb ${yesPrice >= 50 ? "up" : "down"} ${isLive ? "live" : ""}`}
            role="img"
            aria-label={`${round.config.asset}${shown ? ` at ${usdPrice(shown)}` : ""}${move != null ? `, ${move >= 0 ? "up" : "down"} ${Math.abs(move).toFixed(2)}% from the open` : ""}. UP ${yesPrice} cents, DOWN ${100 - yesPrice} cents`}
          >
            <div className="mr-orb-ring" aria-hidden="true" />
            <div className="mr-orb-core">
              <span className="mr-orb-q">{round.config.asset}{closed ? " · close" : ""}</span>
              {shown ? (
                <span className="mr-orb-price spot">{usdPrice(shown)}</span>
              ) : (
                <span className="mr-orb-price">{yesPrice}<em>¢</em></span>
              )}
              {move != null ? (
                <span className={`mr-orb-move ${move > 0 ? "up" : move < 0 ? "down" : ""}`}>
                  {move > 0 ? "▲" : move < 0 ? "▼" : "•"} {Math.abs(move).toFixed(2)}% vs open
                </span>
              ) : shown ? (
                <span className="mr-orb-move">{round.status === "enrolling" ? "live · opens at the start" : "live price"}</span>
              ) : null}
              <span className="mr-orb-sides">
                <span className="y">UP {yesPrice}¢</span>
                <span className="n">DOWN {100 - yesPrice}¢</span>
              </span>
            </div>
          </div>
          )}

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
              const rank = picks && round.status !== "enrolling" ? scorePlace(round, e) : i + 1;
              const made = Object.keys(e.picks ?? {}).length;
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
                  aria-label={picks
                    ? `Rank ${rank}, ${displayName(e)}${isMe ? " (you)" : ""}, ${STATE_LABEL[state]}, ${round.status === "enrolling" ? `${made} of ${totalQs} picks made` : `${e.score ?? 0} of ${totalQs} right`}`
                    : `Rank ${rank}, ${displayName(e)}${isMe ? " (you)" : ""}, ${STATE_LABEL[state]}, vault $${e.bankroll.toFixed(2)}, P&L ${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)}${e.side ? `, holding ${e.side === "YES" ? "UP" : "DOWN"}` : ""}`}
                >
                  <span className="mr-pod-rank">{state === "eliminated" ? "OUT" : `#${rank}`}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="mr-pod-avatar" src={avatarDataUrl(e.wallet, 40)} alt="" width={40} height={40} />
                  <span className="mr-pod-name">
                    {displayName(e)}
                    {isMe && <em>you</em>}
                    {e.isBot && <em className="bot">bot</em>}
                  </span>
                  {picks ? (
                    <>
                      <span className="mr-pod-bank">{round.status === "enrolling" ? `${made}/${totalQs}` : `${e.score ?? 0}/${totalQs}`}</span>
                      <span className="mr-pod-pnl">{round.status === "enrolling" ? "picked" : isComplete && e.prizeUsdc > 0 ? `+$${e.prizeUsdc.toFixed(2)}` : "right"}</span>
                    </>
                  ) : (
                    <>
                      <span className="mr-pod-bank">${e.bankroll.toFixed(2)}</span>
                      <span className={`mr-pod-pnl ${pnl >= 0 ? "up" : "down"}`}>{pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(2)}</span>
                    </>
                  )}
                  {!picks && e.side && state !== "eliminated" && (
                    <span className={`mr-pod-side ${e.side === "YES" ? "yes" : "no"}`}>{e.side === "YES" ? "▲ UP" : "▼ DOWN"}</span>
                  )}
                  <span className={`mr-pod-state s-${state}`}>{STATE_LABEL[state]}</span>
                </li>
              );
            })}
          </ol>

          {pods.length === 0 && !isCancelled && !isComplete && (
            <p className="mr-empty" role="status">No players yet — the first seat is open.</p>
          )}
          {hidden > 0 && <p className="mr-more">+{hidden} more in standings</p>}

          {isComplete && champion && (
            <div className="mr-champ-spot" role="status">
              <div className="mr-champ-title">Champion</div>
              <div className="mr-champ-name">{displayName(champion)}</div>
              <div className="mr-champ-prize">
                {picks ? `${champion.score ?? 0}/${totalQs} right${champion.prizeUsdc > 0 ? ` · +$${champion.prizeUsdc.toFixed(2)}` : ""}`
                  : champion.prizeUsdc > 0 ? `+$${champion.prizeUsdc.toFixed(2)} prize` : "Last trader standing"}
              </div>
            </div>
          )}
          {isCancelled && (
            <div className="mr-cancelled" role="status">Arena closed — every deposit is refunded in full</div>
          )}
        </div>

        <aside className="mr-feed" aria-label="Arena activity">
          <div className="mr-feed-head">Activity</div>
          <ul className="mr-feed-list" aria-live="polite">
            {feed.length === 0 && <li className="empty">{picks ? "Activity appears here as players take their seats." : "Activity appears here as players trade."}</li>}
            {feed.map((ev) => (
              <li key={ev.id} className={`fe fe-${ev.kind}`}>
                <span className="fe-dot" aria-hidden="true" />
                <span className="fe-text">{ev.text}</span>
                {ev.at > 0 && (
                  <time className="fe-time" dateTime={new Date(ev.at).toISOString()} title={new Date(ev.at).toLocaleTimeString()}>{ago(ev.at)}</time>
                )}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}

/** Classify a server history line so the feed can color it. */
function usdPrice(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 })}`;
}

function kindOf(line: string): FeedKind {
  if (/bought|liquidated|parlay|cashed out/i.test(line)) return "trade";
  if (/ wins \$|takes .* USDC| and split \$/i.test(line)) return "champion";
  if (/ settled|locked|opened|closed at| live —|^Results:|^Closing prices/i.test(line)) return "round";
  if (/cancelled|eliminated/i.test(line)) return "elim";
  return "info";
}

function ago(t: number): string {
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Screen-reader line for the predictions orb: each coin's move so far. */
function coinsLabel(round: Round): string {
  const o = round.oracle;
  if (!o?.open) return "Predictions round — prices are taken when picks lock";
  const now = o.close ?? o.last ?? {};
  return (["BTC", "ETH", "SOL"] as const).map((a) => {
    const c = changeOf(o.open[a], now[a]);
    return c === null ? `${a} unavailable` : `${a} ${c >= 0 ? "up" : "down"} ${Math.abs(c * 100).toFixed(2)}%`;
  }).join(", ");
}

/** Even spacing on a circle, rank #1 at 12 o'clock, clockwise by rank. */
function pinFor(i: number, total: number): React.CSSProperties {
  const angle = -Math.PI / 2 + (i / Math.max(1, total)) * Math.PI * 2;
  // Flatter vertically, and clamped so a pod never crosses the stage edge on
  // a short stage (--pod-hx / --pod-hy are half a pod plus a margin).
  const rx = 40, ry = 33;
  return {
    left: `clamp(var(--pod-hx), ${50 + Math.cos(angle) * rx}%, calc(100% - var(--pod-hx)))`,
    top: `clamp(var(--pod-hy), ${50 + Math.sin(angle) * ry}%, calc(100% - var(--pod-hy)))`
  };
}
