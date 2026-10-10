import React from "react";
import { keyframes, prog, usd2 } from "../anim";
import { STATUS_BAR } from "../device";
import { F } from "../fonts";
import { C, rgba } from "../theme";
import {
  ME, PIT, POOL, PRIZES, R1, R1_SETTLE, R2, SEAT, STAKE_TEXT, at, cueBeat, quoteBuy, r1PositionsAt, r1PriceAt, vaultValue
} from "../timeline";
import { Header } from "../ui/Header";
import { Btn, LockIcon, Touch, pressScale } from "../ui/kit";
import { Chart } from "../ui/pit/Chart";
import { Feed, type FeedItem } from "../ui/pit/Feed";
import { Final, type ClaimState } from "../ui/pit/Final";
import { RoundBar, type RoundBarProps } from "../ui/pit/RoundBar";
import { Money, OracleRead } from "../ui/pit/Side";
import { Stage, type OrbProps, type Pod } from "../ui/pit/Stage";
import { Ticket } from "../ui/pit/Ticket";
import {
  CUT_ANGLE, champPrize, clock, cutFeed, cutLegend, cutPods, enrollFeed, enrollPods, finalPods, liveR1Pods, lockSecAt, moneyAt, r2SecAt, settleSecAt, tradeFeed
} from "./common";

// Layout constants (viewport CSS px).
export const PIT_D = { top: 142, topH: 440, mid: 600, stageW: 750 };
export const PIT_M = { stageY: 224, stageH: 300, mid: 664 };
const FEED_ALL: FeedItem[] = [...enrollFeed(), ...tradeFeed(), ...cutFeed()];

/** Scroll offset of the pit page over time — one continuous page from seat to payout. */
export function pitScroll(m: boolean, beat: number): number {
  const T = at("trade"), X = at("cut"), B = at("bell");
  if (!m) {
    const MID = PIT_D.mid - 6;
    return keyframes(beat, [[T + 3.0, 0], [T + 3.9, MID], [X - 0.6, MID], [X + 0.1, 0], [B + 1.9, 0], [B + 2.7, MID - 30]]);
  }
  const CH = PIT_M.mid - (STATUS_BAR + 8);
  const TK = CH + 262 + 12 + 158 + 12 - 46;
  return keyframes(beat, [[T + 1.25, 0], [T + 2.1, CH], [T + 3.5, CH], [T + 4.1, TK], [T + 7.6, TK], [T + 8.3, CH], [X - 0.6, CH], [X + 0.1, 0], [B + 1.6, 0], [B + 2.4, CH + 4]]);
}

function phaseOf(beat: number) {
  if (beat < at("trade")) return "seat" as const;
  if (beat < cueBeat("cut.settle")) return "live" as const;
  if (beat < cueBeat("cut.round2")) return "settling" as const;
  if (beat < at("bell")) return "r2" as const;
  return "complete" as const;
}

function seatedCount(beat: number) {
  return 5 + [cueBeat("seat.seated"), cueBeat("seat.join7"), cueBeat("seat.join8")].filter((b) => beat >= b).length;
}

export const PitPage: React.FC<{ m: boolean; beat: number; scroll?: number; virtualBeat?: number; claim?: ClaimState; showClaim?: boolean; hostAt?: number; lonely?: number }> = ({
  m, beat: realBeat, scroll, virtualBeat, claim = "ready", showClaim = false, hostAt, lonely = 0
}) => {
  const beat = virtualBeat ?? realBeat;
  const phase = phaseOf(beat);
  const seated = seatedCount(beat);
  const lock = at("trade");
  const sy = scroll ?? pitScroll(m, realBeat);
  const r1 = r1PriceAt(beat);
  const lockFlash = 1 - prog(beat, lock, 1.2);

  // Round bar + orb + pods per phase.
  let rb: Omit<RoundBarProps, "m">;
  let orb: OrbProps;
  let pods: Pod[];
  let legend: string;
  let legendTone: "cut" | "muted" = "muted";
  let cutOpacity = 0;
  const spin = beat * 7;
  if (phase === "seat") {
    rb = { round: 1, status: "enrolling", clockLabel: "Locks in", clock: clock(lockSecAt(beat)), pool: PIT.entry * seated, alive: seated, total: seated, yes: PIT.line, line: PIT.line };
    orb = { label: "opening line", price: PIT.line, sub: "Panta's line — the room trades from here", live: false, spin, yes: PIT.line };
    pods = enrollPods(beat, m);
    legend = `${seated}/${PIT.capacity} seats taken`;
  } else if (phase === "live" || phase === "settling") {
    const settling = phase === "settling";
    const gap = Math.round(r1) - PIT.line;
    rb = {
      round: 1, status: settling ? "settling" : "live", clockLabel: "Settles in", clock: clock(settleSecAt(beat)), pool: POOL, alive: PIT.capacity, total: PIT.capacity,
      yes: settling ? R1_SETTLE : r1, line: PIT.line, survive: 4, flash: Math.max(lockFlash, settling ? 1 - prog(beat, cueBeat("cut.settle"), 1) : 0)
    };
    orb = settling
      ? { label: "settled", price: R1_SETTLE, sub: "closing-period average", live: false, spin, yes: R1_SETTLE, flash: 1 - prog(beat, cueBeat("cut.sting"), 1.2) }
      : { label: "room odds", price: r1, sub: `Panta ${PIT.line}¢ · room ${gap > 0 ? "+" : gap < 0 ? "−" : "±"}${Math.abs(gap)}¢`, subTone: gap > 0 ? "up" : gap < 0 ? "down" : "flat", live: true, spin, yes: r1, flash: lockFlash };
    pods = beat >= at("cut") ? cutPods(beat, m) : liveR1Pods(beat, m).pods;
    legend = beat >= cueBeat("cut.sting") ? `${4} alive` : cutLegend();
    legendTone = beat >= cueBeat("cut.sting") ? "muted" : "cut";
    cutOpacity = 1 - prog(beat, cueBeat("cut.sting") + 0.3, 0.6);
  } else if (phase === "r2") {
    const y = keyframes(beat, [[cueBeat("cut.round2"), R2.open], [cueBeat("cut.oracle"), R2.oracle.yes]]);
    rb = { round: 2, status: "live", clockLabel: "Settles in", clock: clock(r2SecAt(beat)), pool: POOL, alive: 4, total: PIT.capacity, yes: y, line: R2.oracle.panta, flash: 1 - prog(beat, cueBeat("cut.round2"), 1) };
    orb = { label: "room odds", price: y, sub: `Panta ${R2.oracle.panta}¢ · room −${R2.oracle.panta - Math.round(y)}¢`, subTone: "down", live: true, spin, yes: y };
    pods = cutPods(beat, m);
    legend = "4 alive";
  } else {
    rb = { round: 2, status: "complete", clockLabel: "Final", clock: "0:00", pool: POOL, alive: 4, total: PIT.capacity, yes: R2.settle, line: R2.oracle.panta, flash: 1 - prog(beat, at("bell"), 1.4) };
    orb = { label: "settled", price: R2.settle, sub: "closing-period average", live: false, spin, yes: R2.settle, flash: 1 - prog(beat, at("bell"), 1.6) };
    pods = finalPods(beat, m);
    legend = "Final standings";
  }

  if (lonely > 0) pods = pods.map((p) => (p.me ? { ...p, scale: 1 + 0.12 * lonely } : { ...p, opacity: (p.opacity ?? 1) * (1 - 0.94 * lonely), scale: (p.scale ?? 1) * (1 - 0.15 * lonely) }));
  const stageW = m ? 370 : PIT_D.stageW;
  const stageH = m ? PIT_M.stageH : PIT_D.topH;
  const champion = phase === "complete" ? { name: ME.name, prize: champPrize(), p: prog(beat, at("bell", 0.5), 0.6) } : null;
  const stage = (
    <Stage m={m} w={stageW} h={stageH} pods={pods} orb={orb} legend={legend} legendTone={legendTone}
      cutAngle={phase === "live" || phase === "settling" ? CUT_ANGLE : null} cutOpacity={cutOpacity} champion={champion} />
  );

  // Seat-phase side panel: the enroll CTA, then "You're in."
  const enterAt = cueBeat("seat.enter");
  const seatedNow = beat >= cueBeat("seat.seated");
  const enrollCta = (
    <div style={{ borderRadius: 14, padding: m ? 12 : 14, display: "flex", flexDirection: "column", gap: 10, background: "linear-gradient(180deg, rgba(19,24,36,0.94), rgba(13,16,23,0.94))", border: `1px solid ${rgba(C.neon, 0.22)}` }}>
      <p style={{ margin: 0, fontFamily: F.text, fontSize: m ? 11.5 : 12.5, lineHeight: 1.5, color: C.text2 }}>
        {!m && <>Call it: <b style={{ color: C.up }}>YES</b> if you think it happens, <b style={{ color: C.down }}>NO</b> if not. </>}
        Your seat is <b style={{ color: C.text }}>${SEAT}</b> — <b style={{ color: C.text }}>${PIT.entry}</b> into the shared prize pool plus a <b style={{ color: C.text }}>${PIT.vault}</b> vault you trade with.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ position: "relative", flex: 1, transform: `scale(${pressScale(beat, enterAt)})` }}>
          <Btn full h={m ? 40 : 40} fs={13.5}>Enter the pit</Btn>
          <Touch beat={beat} at={enterAt} />
        </div>
        {!m && <Btn kind="secondary" h={40} fs={12.5}>Host your own</Btn>}
      </div>
    </div>
  );
  const youreIn = (
    <div style={{ borderRadius: 14, padding: m ? 12 : 14, display: "flex", flexDirection: "column", gap: 10, background: "linear-gradient(180deg, rgba(19,24,36,0.94), rgba(13,16,23,0.94))", border: `1px solid ${rgba(C.neon, 0.4)}`, boxShadow: `0 0 ${24 * (1 - prog(beat, cueBeat("seat.seated"), 1.5))}px ${rgba(C.neon, 0.4)}` }}>
      <p style={{ margin: 0, fontFamily: F.text, fontSize: m ? 12 : 13, color: C.text2 }}>
        <b style={{ color: C.text }}>You&apos;re in.</b> Trading opens when enrollment locks in <b style={{ fontFamily: F.mono, color: C.text }}>{clock(lockSecAt(beat))}</b>.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: F.mono, fontSize: 9.5, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: C.text3, whiteSpace: "nowrap" }}>Opening call</span>
        <div style={{ display: "flex", gap: 5, flex: 1 }}>
          {[["▲ YES", true], ["▼ NO", false], ["Decide later", false]].map(([l, on]) => (
            <span key={l as string} style={{
              flex: 1, textAlign: "center", padding: "6px 0", borderRadius: 7, fontFamily: F.text, fontWeight: 700, fontSize: m ? 11 : 11.5,
              color: on ? C.up : C.text3, background: on ? rgba(C.up, 0.14) : "rgba(10,13,19,0.6)", border: `1px solid ${on ? rgba(C.up, 0.6) : C.border}`
            }}>{l}</span>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", fontFamily: F.text, fontSize: m ? 10.5 : 11.5, lineHeight: 1.4, color: C.text3 }}>
        <span style={{ color: C.neon, flexShrink: 0 }}><LockIcon size={14} /></span>
        Hidden until trading opens — seat calls stay secret while the pit fills.
      </div>
    </div>
  );

  // Trade row (terminal + ticket).
  const pos = r1PositionsAt(beat).me;
  const myShares = pos.yes;
  const myVault = vaultValue(pos, phase === "seat" ? PIT.line : r1);
  const keys = [0, 1, 2, 3].filter((i) => beat >= cueBeat(`trade.key.${i}`)).length;
  const filled = beat >= cueBeat("trade.myFill");
  const stake = filled ? "" : STAKE_TEXT.slice(0, keys);
  const quote = quoteBuy(beat, "YES", Number(stake || 0));
  const money = moneyAt(beat, r1);
  const chartW = m ? 344 : 572;
  const chart = (
    <div style={{ borderRadius: 14, padding: m ? "12px 12px 10px" : "14px 14px 12px", background: "linear-gradient(180deg, rgba(19,24,36,0.94), rgba(13,16,23,0.94))", border: `1px solid ${rgba(C.neon, 0.18)}` }}>
      <Chart m={m} w={chartW} beat={beat} tape={phase === "seat" ? [] : R1.tape} from={lock} to={cueBeat("cut.settle")}
        reference={PIT.line} closingFrom={lock + (cueBeat("cut.settle") - lock) * 0.8} sub={`bell in ${clock(settleSecAt(beat))}`} height={m ? 136 : 168} />
    </div>
  );
  const ticket = (
    <Ticket m={m} beat={beat} yes={r1} vault={myVault} cash={pos.cash} pnl={myVault - PIT.vault}
      position={myShares > 0 ? `${myShares.toFixed(1)} YES @ ${((pos.cost / myShares) * 100).toFixed(0)}¢` : "—"}
      stake={stake} focused={beat >= cueBeat("trade.focus") && !filled} focusAt={cueBeat("trade.focus")} buyAt={cueBeat("trade.buy")}
      quote={quote} closesIn={clock(Math.max(0, settleSecAt(beat) - 30))} filledP={filled ? 1 - prog(beat, cueBeat("trade.myFill"), 1.2) : 0} />
  );

  const claimDoneAt = cueBeat("payout.done");
  const finalBlock = (
    <Final m={m} beat={realBeat} board={prog(realBeat, at("bell", 2.8), 2.5, (t) => t) * 2} boardRows={m ? (showClaim ? 4 : 8) : (showClaim ? 6 : 8)} claim={claim}
      withdrawAt={cueBeat("payout.withdraw")} hostAt={hostAt} showClaim={showClaim} doneAt={claimDoneAt} />
  );

  const feedItems = phase === "complete"
    ? [...FEED_ALL, { id: "r2settled", text: "Round 2 settled — final standings are in.", kind: "round" as const, born: at("bell") },
       { id: "champ", text: `${ME.name} wins ${usd2(PRIZES.me ?? 0)} from the ${usd2(POOL)} pool.`, kind: "champion" as const, born: at("bell", 0.4) }]
    : FEED_ALL;

  if (!m) {
    const sideTop = phase === "seat" ? (seatedNow ? youreIn : enrollCta) : phase === "live" && beat < at("trade", 4) ? <Money m={false} w="100%" {...money} /> : null;
    const oracleP = prog(beat, cueBeat("cut.oracle"), 0.55);
    return (
      <div style={{ position: "absolute", inset: 0, transform: `translateY(${-sy}px)` }}>
        <Header m={false} beat={beat} account={1} arenaCode={PIT.code} />
        <RoundBar m={false} {...rb} />
        <div style={{ position: "absolute", left: 14, top: PIT_D.top, display: "flex", gap: 12 }}>
          {stage}
          <div style={{ width: 330, height: PIT_D.topH, display: "flex", flexDirection: "column", gap: 12, position: "relative", opacity: 1 - 0.8 * lonely }}>
            {sideTop}
            <div style={{ flex: 1, minHeight: 0 }}>
              <Feed m={false} beat={beat} items={feedItems} w="100%" h={sideTop ? (phase === "seat" ? 228 : 330) : PIT_D.topH} />
            </div>
            {phase === "r2" && oracleP > 0 && (
              <div style={{ position: "absolute", left: 0, right: 0, top: 0, opacity: oracleP, transform: `translateX(${(1 - oracleP) * 60}px)` }}>
                <OracleRead m={false} w="100%" glow={1 - prog(beat, cueBeat("cut.oracle") + 0.4, 1.5)} />
              </div>
            )}
          </div>
        </div>
        <div style={{ position: "absolute", left: 14, top: PIT_D.mid, width: 1092 }}>
          {phase === "complete" ? finalBlock : (
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ width: 600, display: "flex", flexDirection: "column", gap: 12 }}>
                {chart}
                <div style={{ display: "flex", gap: 12 }}>
                  <Feed m={false} beat={beat} items={tradeFeed()} w={360} h={384} />
                  <div style={{ flex: 1 }}><Money m={false} w="100%" {...money} /></div>
                </div>
              </div>
              <div style={{ width: 480 }}>{ticket}</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Mobile.
  const oracleP = prog(beat, cueBeat("cut.oracle"), 0.55);
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div style={{ position: "absolute", inset: 0, transform: `translateY(${-sy}px)` }}>
        <div style={{ height: STATUS_BAR }} />
        <Header m beat={beat} account={1} arenaCode={PIT.code} />
        <RoundBar m {...rb} />
        <div style={{ position: "absolute", left: 10, top: PIT_M.stageY }}>{stage}</div>
        <div style={{ position: "absolute", left: 10, right: 10, top: PIT_M.stageY + PIT_M.stageH + 10 }}>
          {phase === "seat" ? (seatedNow ? youreIn : enrollCta) : <Money m w="100%" {...money} />}
        </div>
        <div style={{ position: "absolute", left: 10, right: 10, top: PIT_M.mid, display: "flex", flexDirection: "column", gap: 12 }}>
          {phase === "complete" ? finalBlock : (
            <>
              {chart}
              <Feed m beat={beat} items={tradeFeed()} w="100%" h={158} rowH={36} />
              {ticket}
            </>
          )}
        </div>
      </div>
      {phase === "r2" && oracleP > 0 && (
        <div style={{ position: "absolute", left: 10, right: 10, top: 300, opacity: oracleP, transform: `translateY(${(1 - oracleP) * 120}px)`, zIndex: 60 }}>
          <OracleRead m w="100%" glow={1 - prog(beat, cueBeat("cut.oracle") + 0.4, 1.5)} />
        </div>
      )}
    </div>
  );
};
