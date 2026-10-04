"use client";

/**
 * UI pieces for the Streak arena: the current leg (pick window, then the
 * live leg), the legs played so far, and the roster of who is still in.
 * Everything shown comes from the round; nothing here decides an outcome.
 */

import { answersFor, changeOf, optionLabel, type PickQuestion } from "@/lib/predictions";
import { canPick, currentLeg, optionWord, type StreakLeg } from "@/lib/streak";
import type { Entrant, Round } from "@/lib/royale";
import { avatarDataUrl } from "@/lib/avatars";
import { displayName } from "@/lib/username";
import { pctText } from "@/app/Predictions";

const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function optionText(q: PickQuestion, id: string): string {
  if (q.kind === "direction") return id === "UP" ? "▲ Up" : "▼ Down";
  return optionLabel(q, id);
}
const tone = (q: PickQuestion, id: string) => (q.kind === "direction" ? (id === "UP" ? "up" : "down") : "coin");

/** Right answer(s) of a leg so far: final once resolved, else live from the latest prices. */
export function legAnswer(round: Round, leg: StreakLeg): string[] | null {
  if (leg.answer) return leg.answer;
  if (!leg.open) return null;
  return answersFor([leg.question], leg.open, (round.oracle?.last ?? {}) as Record<string, number>)[leg.question.id] ?? [];
}

/** "Pick in 0:12" / "Ends in 1:40" for the current phase. */
export function phaseText(round: Round, now: number): string {
  const st = round.streak;
  if (!st) return "";
  if (round.status === "enrolling") return "Starts when enrollment locks";
  if (st.phase === "picking") return st.phaseEndsAt > now ? `Picks lock in ${clock(st.phaseEndsAt - now)}` : "Picks locked — starting the leg…";
  if (st.phase === "running") return st.phaseEndsAt > now ? `Leg ends in ${clock(st.phaseEndsAt - now)}` : "Checking the close…";
  return "Game over";
}

/** The current leg: answer buttons while its window is open, then the live leg. */
export function StreakLegCard({
  round, me, now, busy, myDraft, onPick
}: {
  round: Round;
  me: Entrant | null;
  now: number;
  busy: boolean;
  /** A pick on its way to the server, shown at once. */
  myDraft?: string;
  onPick: (optionId: string) => void;
}) {
  const st = round.streak!;
  const leg = currentLeg(st);
  const q = leg.question;
  const running = round.status === "live" && st.phase === "running";
  const open = me ? canPick(round, me, now) : false;
  const mine = myDraft ?? (me ? leg.picks[me.id] || undefined : undefined);
  const answer = running ? legAnswer(round, leg) : null;
  const alive = round.entrants.filter((e) => e.eliminatedRound === null);
  const pickedCount = alive.filter((e) => e.id in leg.picks).length;
  const now$ = (round.oracle?.last ?? {}) as Record<string, number>;
  return (
    <div className={`sk-leg ${running ? "running" : "picking"}`}>
      <div className="sk-leg-head">
        <span className="sk-leg-n">Leg {leg.n} <em>of up to {st.maxLegs}</em></span>
        <span className={`sk-phase ${open && !mine ? "urgent" : ""}`}>{phaseText(round, now)}</span>
      </div>
      <h3 className="sk-q">{q.text}</h3>
      <p className="sk-rule">{q.rule}{running ? " Judged from the price when this leg started." : ""}</p>

      {running ? (
        <>
          <div className="sk-moves">
            {q.assets.map((a) => {
              const c = changeOf(leg.open?.[a], now$[a]);
              return <span key={a} className={c === null ? "" : c > 0 ? "up" : c < 0 ? "down" : ""}>{a} {pctText(c, 3)}</span>;
            })}
          </div>
          <div className="sk-split" aria-label="How the room picked">
            {q.options.map((o) => {
              const n = alive.filter((e) => leg.picks[e.id] === o.id).length;
              const win = !!answer?.includes(o.id);
              return (
                <span key={o.id} className={`pk-chip ${tone(q, o.id)} ${win ? "win" : ""} ${mine === o.id ? "mine" : ""}`}
                  title={`${n} picked ${optionLabel(q, o.id)}${win ? " — winning right now" : ""}`}>
                  {optionText(q, o.id)} <em>{n}</em>
                </span>
              );
            })}
          </div>
        </>
      ) : (
        <div className={`pk-opts n${q.options.length} sk-opts`} role="radiogroup" aria-label={q.text}>
          {q.options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={mine === o.id}
              className={`pk-opt ${tone(q, o.id)} ${mine === o.id ? "on" : ""}`}
              disabled={!open || busy}
              onClick={() => onPick(o.id)}
            >
              {optionText(q, o.id)}
            </button>
          ))}
        </div>
      )}

      <p className="sk-status" role="status">
        {!me ? (
          running ? <>{pickedCount} of {alive.length} players picked this leg.</> : <>{alive.length} player{alive.length === 1 ? "" : "s"} in.</>
        ) : me.eliminatedRound !== null ? (
          <>You&apos;re out — knocked out on leg {me.eliminatedRound}. You can keep watching.</>
        ) : running ? (
          !mine ? <b className="down">You didn&apos;t pick this leg — you&apos;re out unless everyone misses or it ends level.</b>
            : !answer || answer.length === 0 ? <>You picked <b>{optionLabel(q, mine)}</b>. Too close to call right now.</>
            : answer.includes(mine) ? <>You picked <b>{optionLabel(q, mine)}</b> — <b className="up">safe right now</b>.</>
            : <>You picked <b>{optionLabel(q, mine)}</b> — <b className="down">behind right now</b>.</>
        ) : mine && !open ? (
          <>You picked <b>{optionLabel(q, mine)}</b>. Picks are locked — the leg starts in a moment.</>
        ) : mine ? (
          <>You picked <b>{optionLabel(q, mine)}</b>. Hidden until picks lock — you can still change it.</>
        ) : open ? (
          <b className="down">Pick before the window closes — no pick and you&apos;re out.</b>
        ) : (
          <>Waiting for the leg to open.</>
        )}
      </p>
    </div>
  );
}

/** Legs played so far, newest first. */
export function StreakHistory({ round, me }: { round: Round; me: Entrant | null }) {
  const done = (round.streak?.legs ?? []).filter((l) => l.answer).reverse();
  if (done.length === 0) return null;
  return (
    <ol className="sk-history" aria-label="Legs played">
      {done.map((leg) => {
        const mine = me ? leg.picks[me.id] || undefined : undefined;
        const outHere = !!me && leg.out?.includes(me.id);
        const result = leg.answer!.length === 0 ? "Level — nobody out"
          : leg.allMissed ? `${leg.answer!.map((a) => optionWord(leg.question, a)).join(" & ")} — everyone missed, nobody out`
          : `${leg.answer!.map((a) => optionWord(leg.question, a)).join(" & ")} · ${leg.out?.length ?? 0} out`;
        return (
          <li key={leg.n} className={`sk-h ${outHere ? "me-out" : ""}`}>
            <span className="sk-h-n">L{leg.n}</span>
            <span className="sk-h-q">{leg.question.text}<em>{result}</em></span>
            <span className="sk-h-me">
              {!me ? "" : mine ? (leg.answer!.includes(mine) || leg.answer!.length === 0 || leg.allMissed ? "✓" : "✗") : outHere ? "✗" : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Who is still in, how long everyone lasted, and who has picked this leg. */
export function StreakRoster({ round, standings, wallet }: { round: Round; standings: Entrant[]; wallet: string | null }) {
  const st = round.streak;
  const leg = st ? currentLeg(st) : null;
  const picking = round.status === "enrolling" || (round.status === "live" && st?.phase === "picking");
  const alive = standings.filter((e) => e.eliminatedRound === null).length;
  return (
    <aside className="roster">
      <div className="roster-head">
        <span>Still in</span>
        <span className="cut muted">{alive} of {standings.length}</span>
      </div>
      <ul>
        {standings.map((e) => {
          const out = e.eliminatedRound !== null;
          const picked = !!leg && e.id in leg.picks;
          const legs = e.score ?? 0;
          return (
            <li key={e.id}>
              <div className={`r-row ${e.wallet === wallet ? "me" : ""} ${out ? "dead" : ""}`}>
                <span className="r-rank">{out ? "✕" : "●"}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="r-avatar" src={avatarDataUrl(e.wallet, 24)} width={24} height={24} alt="" />
                <span className="r-name">{displayName(e)}{e.isBot ? <em>bot</em> : ""}{e.wallet === wallet ? <em>you</em> : ""}</span>
                <span className="r-bank">{legs} leg{legs === 1 ? "" : "s"}</span>
                <span className={`r-pnl ${!out && picking && picked ? "up" : ""}`}>
                  {out ? `out L${e.eliminatedRound}` : round.status === "complete" ? (e.prizeUsdc > 0 ? `+${usd2.format(e.prizeUsdc)}` : "") : picking ? (picked ? "picked" : "—") : "in"}
                </span>
              </div>
            </li>
          );
        })}
        {standings.length === 0 && <li className="empty">Waiting for players…</li>}
      </ul>
    </aside>
  );
}
