"use client";

/**
 * UI pieces for the Predictions arena: the picks editor (seat modal and
 * "your picks" panel), the live question board, the roster and the results.
 * All state comes from the round; nothing here decides an outcome.
 */

import { answersFor, changeOf, optionLabel, type PickQuestion, type Picks } from "@/lib/predictions";
import { paidPlaces, scorePlace, type Entrant, type Round } from "@/lib/royale";
import { avatarDataUrl } from "@/lib/avatars";
import { displayName } from "@/lib/username";

const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** "+0.12%" / "−0.25%" from a fractional change. */
export function pctText(c: number | null, digits = 2): string {
  if (c === null) return "—";
  return `${c >= 0 ? "+" : "−"}${Math.abs(c * 100).toFixed(digits)}%`;
}

/** Prices the round is judged on right now: the close once it has one, else the latest sample. */
export function judgedPrices(round: Round): Record<string, number> {
  const o = round.oracle;
  return (o?.close ?? o?.last ?? {}) as Record<string, number>;
}

/** Right answers as things stand — final once the round has closed. */
export function currentAnswers(round: Round): Record<string, string[]> | null {
  if (round.predictions?.answers) return round.predictions.answers;
  const open = round.oracle?.open;
  if (!round.predictions || !open || round.status !== "live") return null;
  return answersFor(round.predictions.questions, open, judgedPrices(round));
}

/** How many questions a player has answered (works on redacted picks too). */
export function picksMade(e: Entrant | null | undefined): number {
  return e?.picks ? Object.keys(e.picks).length : 0;
}

function optionText(q: PickQuestion, id: string): string {
  if (q.kind === "direction") return id === "UP" ? "▲ Up" : "▼ Down";
  return optionLabel(q, id);
}

function optionTone(q: PickQuestion, id: string): string {
  return q.kind === "direction" ? (id === "UP" ? "up" : "down") : "coin";
}

/** The five questions with a button per answer. */
export function PicksEditor({
  questions, picks, onPick, disabled, compact
}: {
  questions: PickQuestion[];
  picks: Picks;
  onPick: (questionId: string, optionId: string) => void;
  disabled?: boolean;
  /** Hide the one-line rules (tight spaces). */
  compact?: boolean;
}) {
  return (
    <div className={`pk-editor ${compact ? "compact" : ""}`}>
      {questions.map((q, i) => (
        <div key={q.id} className={`pk-q ${picks[q.id] ? "done" : ""}`} role="radiogroup" aria-label={q.text}>
          <div className="pk-q-head">
            <span className="pk-n" aria-hidden="true">{i + 1}</span>
            <span className="pk-q-text">{q.text}</span>
          </div>
          <div className={`pk-opts n${q.options.length}`}>
            {q.options.map((o) => {
              const on = picks[q.id] === o.id;
              return (
                <button
                  type="button"
                  key={o.id}
                  role="radio"
                  aria-checked={on}
                  className={`pk-opt ${optionTone(q, o.id)} ${on ? "on" : ""}`}
                  disabled={disabled}
                  onClick={() => onPick(q.id, o.id)}
                >
                  {optionText(q, o.id)}
                </button>
              );
            })}
          </div>
          {!compact && <p className="pk-rule">{q.rule}</p>}
        </div>
      ))}
    </div>
  );
}

/**
 * The questions during and after the round: how each coin has moved, which
 * answer is winning (or won), how the room picked, and whether my pick is
 * right.
 */
export function PicksBoard({ round, me, entrants }: { round: Round; me: Entrant | null; entrants: Entrant[] }) {
  const questions = round.predictions?.questions ?? [];
  const open = round.oracle?.open ?? {};
  const now = judgedPrices(round);
  const answers = currentAnswers(round);
  const final = !!round.predictions?.answers;
  return (
    <ol className="pk-board" aria-label={final ? "Results" : "Live questions"}>
      {questions.map((q) => {
        const right = answers?.[q.id] ?? [];
        const mine = me?.picks?.[q.id] || undefined;
        const verdict = !answers ? "wait" : !mine ? "none" : right.length === 0 ? "void" : right.includes(mine) ? "right" : "wrong";
        return (
          <li key={q.id} className={`pk-row v-${verdict}`}>
            <div className="pk-row-q">
              <b>{q.text}</b>
              <span className="pk-moves">
                {q.assets.map((a) => {
                  const c = changeOf(open[a], now[a]);
                  // Three decimals: small moves that decide a head-to-head stay visible.
                  return <span key={a} className={c === null ? "" : c > 0 ? "up" : c < 0 ? "down" : ""}>{a} {pctText(c, 3)}</span>;
                })}
              </span>
            </div>
            <div className="pk-row-opts">
              {q.options.map((o) => {
                const n = entrants.filter((e) => e.picks?.[q.id] === o.id).length;
                const lead = right.includes(o.id);
                return (
                  <span key={o.id} className={`pk-chip ${optionTone(q, o.id)} ${lead ? "win" : ""} ${mine === o.id ? "mine" : ""}`}
                    title={`${n} player${n === 1 ? "" : "s"} picked ${optionLabel(q, o.id)}${lead ? final ? " — the answer" : " — winning right now" : ""}`}>
                    {optionText(q, o.id)} <em>{n}</em>
                  </span>
                );
              })}
            </div>
            <span className="pk-verdict" aria-label={verdictLabel(verdict, final)}>
              {verdict === "right" ? "✓" : verdict === "wrong" ? "✗" : verdict === "void" ? "=" : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function verdictLabel(v: string, final: boolean): string {
  if (v === "right") return final ? "Your pick was right" : "Your pick is right so far";
  if (v === "wrong") return final ? "Your pick was wrong" : "Your pick is behind so far";
  if (v === "void") return "Level — nobody scores this one";
  return "";
}

/** Standings for a predictions round: picks made while enrolling, score after. */
export function PicksRoster({ round, standings, wallet }: { round: Round; standings: Entrant[]; wallet: string | null }) {
  const total = round.predictions?.questions.length ?? 0;
  const enrolling = round.status === "enrolling";
  const live = round.status === "live";
  const places = paidPlaces(round);
  return (
    <aside className="roster">
      <div className="roster-head">
        <span>Standings</span>
        {live && <span className="cut">{places === 1 ? "Top score wins" : `Top ${places} paid`}</span>}
        {enrolling && <span className="cut muted">Picks hidden</span>}
      </div>
      <ul>
        {standings.map((e) => {
          const made = picksMade(e);
          const paid = !e.isBot && scorePlace(round, e, true) <= places;
          return (
            <li key={e.id}>
              <div className={`r-row ${e.wallet === wallet ? "me" : ""} ${live && paid ? "money" : ""}`}>
                <span className="r-rank">{enrolling ? "·" : scorePlace(round, e)}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="r-avatar" src={avatarDataUrl(e.wallet, 24)} width={24} height={24} alt="" />
                <span className="r-name">{displayName(e)}{e.isBot ? <em>bot</em> : ""}{e.wallet === wallet ? <em>you</em> : ""}</span>
                <span className="r-bank">{enrolling ? `${made}/${total}` : `${e.score ?? 0}/${total}`}</span>
                <span className={`r-pnl ${enrolling ? (made >= total ? "up" : "") : live && paid ? "up" : ""}`}>
                  {enrolling ? (made >= total ? "ready" : "picking") : live ? (e.isBot ? "" : paid ? "paid" : "") : e.prizeUsdc > 0 ? `+${usd2.format(e.prizeUsdc)}` : ""}
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
