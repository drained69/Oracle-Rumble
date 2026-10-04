/**
 * Market Royale — battle-royale round engine.
 *
 * A round is a survival competition over a single Panta market. Every
 * entrant deposits the same entry fee, receives the same isolated starting
 * bankroll, and trades YES/NO shares on the round's market. When the round
 * window closes the arena ranks entrants by final bankroll and eliminates
 * the bottom half. Survivors advance to a fresh round until one remains or
 * the round limit is hit. The funded entry pool pays out to survivors.
 *
 * This module is pure domain logic — no I/O. The store (lib/round-store.ts)
 * persists it; the API routes drive the state machine; the keeper advances
 * timers. Trading is scoped to each entrant's bankroll ledger; Panta is the
 * price oracle and the settlement source of truth.
 *
 * Trust model (current): entry pool + bankrolls are ledgered server-side.
 * The on-chain TraderVault escrow (Anchor program) is the next milestone —
 * until then the prize pool is an accounting figure, flagged as such in the UI.
 */

import { jointProbability } from "@/lib/joint-prob";
import { answersFor, normalizePicks, resultsLine, scorePicks, type Picks, type PredictionsState } from "@/lib/predictions";

export type RoundStatus =
  | "enrolling"   // accepting entrants, before lock
  | "live"        // trading window open
  | "settling"    // window closed, computing ranks
  | "advancing"   // survivors promoted, next round spinning up
  | "complete"    // a champion remains (or round limit hit)
  | "cancelled";  // not enough entrants — pool refunded

export type Side = "YES" | "NO";

export type Entrant = {
  id: string;
  wallet: string;         // base58 pubkey, or bot:<name>
  nickname: string;
  isBot: boolean;
  joinedAt: number;       // ms — earlier entry wins ties
  bankroll: number;       // USDC, mark-to-market
  cash: number;           // uninvested USDC
  shares: number;         // outcome shares held
  side: Side | null;      // which side the shares are
  avgPrice: number;       // cents, cost basis of current position
  eliminatedRound: number | null;
  rank: number | null;    // filled at settlement
  prizeUsdc: number;      // prize-pool share won at the final (0 until then)
  parlays: ParlayTicket[];// open + settled parlay tickets bought from the vault
  /**
   * The direction picked when taking the seat — YES = UP, NO = DOWN. Placed
   * the moment the round goes live, then cleared. Null means the player
   * decides once trading opens.
   */
  openingCall?: Side | null;
  /** Share of the vault the opening call uses (25/50/100; unset = 100). */
  openingCallPct?: number;
  /** Predictions arena: this player's answers (question id → option id). */
  picks?: Picks;
  /** Predictions arena: right answers so far (live) or final. */
  score?: number;
};

/** One leg of a placed parlay — an UP/DOWN call on a board market. */
export type ParlayLegState = {
  marketId: string;
  asset: string;
  question: string;
  side: Side;
  entryPrice: number;     // cents, the leg's side price at placement
};

/**
 * A native parlay bought from a player's vault. Priced by lib/parlay.ts
 * (variance fee, combined price). It pays `shares` USDC if every leg lands,
 * with a 50/50 fallback per voided leg — the parlayit model. Held inside the
 * round vault so it marks-to-market and settles alongside single trades.
 */
export type ParlayTicket = {
  id: string;
  legs: ParlayLegState[];
  stake: number;              // gross USDC staked from the vault
  fee: number;                // variance fee withheld
  shares: number;             // payout units if all legs win (== max payout)
  combinedEntryPrice: number; // cents, combined price at placement
  potentialPayout: number;    // USDC if every leg lands
  status: "open" | "won" | "lost" | "void" | "cashed_out";
  settledPayout: number;      // USDC credited at settlement (or at cashout)
  placedAt: number;
  cashedOutAt?: number;       // ms epoch when the ticket was cashed out
};

/** Live YES price (cents) per market id, for valuing multi-asset parlays. */
export type PriceMap = Record<string, number>;

/**
 * Single Round is a quick match — one market, one settlement, pay the top
 * finishers. Royale is 2–4 rounds — each settlement cuts the bottom half and
 * survivors carry the bankroll they earned into the next round. Predictions
 * is a call contest with no trading: five hidden picks on BTC, ETH and SOL,
 * most right answers wins (lib/predictions.ts).
 */
export type RoundFormat = "single" | "royale" | "predictions";

export type RoundConfig = {
  marketId: string;
  marketQuestion: string;
  category: string;
  asset: string;          // display label, e.g. "SOL" / "BTC"
  format: RoundFormat;    // single quick match or multi-round royale
  host: string;           // wallet that configured the rumble, or "" (auto)
  entryUsdc: number;      // entry fee everyone pays → shared prize pool
  startingBankroll: number; // starting trading vault everyone gets
  capacity: number;       // max entrants (player limit)
  minEntrants: number;    // below this at lock → cancel/refund
  enrollmentSec: number;  // enrollment window
  liveSec: number;        // trading window per round
  roundLimit: number;     // rounds before forced finish (1 for single, 2–4 royale)
};

// Host-configurable bounds. The host picks values inside these; the engine
// clamps anything out of range so a malformed config can't grief the arena.
export const HOST_LIMITS = {
  entryUsdc: { min: 1, max: 100 },
  startingBankroll: { min: 5, max: 500 },
  capacity: { min: 2, max: 16 },
  royaleRounds: { min: 2, max: 4 },
  // Scheduled events extend enrollment up to 3 hours so friends have time
  // to see the invite link before the first lock.
  enrollmentSec: { min: 20, max: 10_800 },
  liveSec: { min: 60, max: 3_600 }
} as const;

/** Why a host's entry/vault amounts would be changed by the server, or "". */
export function hostAmountError(entry: number, vault: number, format: RoundFormat = "single"): string {
  const L = HOST_LIMITS;
  const e = amountErrorFor("Entry", entry, L.entryUsdc.min, L.entryUsdc.max);
  if (e) return e;
  if (format === "predictions") return ""; // no trading vault
  return amountErrorFor("Vault", vault, L.startingBankroll.min, L.startingBankroll.max);
}

function amountErrorFor(label: string, n: number, min: number, max: number): string {
  if (!Number.isFinite(n) || !Number.isInteger(n)) return `${label} must be a whole dollar amount.`;
  if (n < min) return `${label} must be at least $${min}.`;
  if (n > max) return `${label} must be $${max} or less.`;
  return "";
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));

/**
 * Sanitize a host-supplied config into a safe RoundConfig. Every player gets
 * the SAME entry and the SAME starting vault — a host can never hand anyone a
 * bigger vault, which is the core fairness rule of Market Royale.
 */
export function normalizeConfig(base: RoundConfig, patch: Partial<RoundConfig>): RoundConfig {
  const format: RoundFormat = patch.format === "single" || patch.format === "royale" || patch.format === "predictions"
    ? patch.format : base.format;
  const L = HOST_LIMITS;
  const capacity = clamp(patch.capacity ?? base.capacity, L.capacity.min, L.capacity.max);
  const roundLimit = format !== "royale"
    ? 1
    : clamp(patch.roundLimit ?? base.roundLimit, L.royaleRounds.min, L.royaleRounds.max);
  // Only the host-tunable rules are taken from `patch` — never arbitrary
  // fields from a request body.
  return {
    ...base,
    host: typeof patch.host === "string" ? patch.host.slice(0, 64) : base.host,
    format,
    entryUsdc: clamp(patch.entryUsdc ?? base.entryUsdc, L.entryUsdc.min, L.entryUsdc.max),
    // A predictions arena has nothing to trade, so no vault.
    startingBankroll: format === "predictions" ? 0 : clamp(patch.startingBankroll ?? base.startingBankroll, L.startingBankroll.min, L.startingBankroll.max),
    capacity,
    minEntrants: clamp(patch.minEntrants ?? base.minEntrants, 2, capacity),
    enrollmentSec: clamp(patch.enrollmentSec ?? base.enrollmentSec, L.enrollmentSec.min, L.enrollmentSec.max),
    liveSec: clamp(patch.liveSec ?? base.liveSec, L.liveSec.min, L.liveSec.max),
    roundLimit
  };
}

/**
 * The escrow program needs a nonzero vault per seat. A predictions arena has
 * no trading vault, so its on-chain vault is one base unit (0.000001 USDC),
 * returned to every player at settlement.
 */
export const PICKS_CHAIN_VAULT_USDC = 0.000001;

/** Vault amount per seat in the on-chain escrow. */
export function chainVaultUsdc(config: RoundConfig): number {
  return config.format === "predictions" ? PICKS_CHAIN_VAULT_USDC : config.startingBankroll;
}

/** What one seat deposits into the escrow: entry plus vault. */
export function seatCostUsdc(config: RoundConfig): number {
  return config.entryUsdc + chainVaultUsdc(config);
}

// Market-Royale prize split of the shared pool among the top finishers.
// A 2-player game is a duel — winner takes the whole pool. With 3+ funded
// players the pool splits 62.5% / 23.4375% / 14.0625%, and 1st absorbs any
// rounding remainder. The arena takes no cut.
const SPLIT_3 = [0.625, 0.234375, 0.140625] as const;

/**
 * Distribute `prizePoolUsdc` across the ranked winners (rank 1 first).
 * `fundedPlayers` is how many real players funded the pool — it decides
 * whether this is a duel (1 paid place) or a 3-way split. Works in integer
 * micro-USDC so the parts always re-sum to the pool exactly.
 */
export function computePayouts(prizePoolUsdc: number, rankedWinnerIds: string[], fundedPlayers: number): Record<string, number> {
  const pool = Math.max(0, Math.round(prizePoolUsdc * 1e6)); // micro-USDC
  const out: Record<string, number> = {};
  if (pool === 0 || rankedWinnerIds.length === 0) return out;
  if (fundedPlayers <= 2) {
    out[rankedWinnerIds[0]] = pool / 1e6;
    return out;
  }
  const places = Math.min(3, rankedWinnerIds.length);
  let assigned = 0;
  for (let i = 1; i < places; i++) {
    const part = Math.floor(pool * SPLIT_3[i]);
    out[rankedWinnerIds[i]] = part / 1e6;
    assigned += part;
  }
  out[rankedWinnerIds[0]] = (pool - assigned) / 1e6; // 1st gets the remainder
  return out;
}

/**
 * Like computePayouts, but finishers can tie: `groups` lists the ranked
 * players best first, tied players in one group. A group shares the prize of
 * every place it covers equally (two players tied for 1st split 1st + 2nd).
 * Integer micro-USDC; the parts re-sum to the pool exactly.
 */
export function computeGroupPayouts(prizePoolUsdc: number, groups: string[][], fundedPlayers: number): Record<string, number> {
  const pool = Math.max(0, Math.round(prizePoolUsdc * 1e6));
  const out: Record<string, number> = {};
  const total = groups.reduce((n, g) => n + g.length, 0);
  if (pool === 0 || total === 0) return out;
  const places = fundedPlayers <= 2 ? 1 : Math.min(3, total);
  const amounts: number[] = [];
  for (let i = 1; i < places; i++) amounts[i] = Math.floor(pool * SPLIT_3[i]);
  amounts[0] = pool - amounts.slice(1).reduce((a, b) => a + b, 0);
  let k = 0;
  for (const g of groups) {
    const share = amounts.slice(k, k + g.length).reduce((a, b) => a + b, 0);
    k += g.length;
    if (share <= 0 || g.length === 0) continue;
    const each = Math.floor(share / g.length);
    g.forEach((id, i) => { out[id] = (each + (i === 0 ? share - each * g.length : 0)) / 1e6; });
  }
  return out;
}

/**
 * How an arena's escrow is paid out at the end. Each player gets their prize,
 * plus a share of the players' vault money in proportion to the vault value
 * they finished with — so one player's trading losses fund another's gains,
 * and the total always equals `potUsdc` exactly (nothing is capped away and
 * nothing is left locked in escrow). If every vault finished at $0 the vault
 * money is returned equally. Works in micro-USDC.
 */
export function payoutShares(players: Array<{ key: string; cash: number; prize: number }>, potUsdc: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (players.length === 0) return out;
  const pot = Math.max(0, Math.floor(potUsdc * 1e6 + 1e-6));
  let prizes = players.map((p) => Math.max(0, Math.floor(p.prize * 1e6 + 1e-6)));
  const prizeSum = prizes.reduce((a, b) => a + b, 0);
  if (prizeSum > pot) prizes = prizes.map((x) => Math.floor((x * pot) / prizeSum));
  const vaultPot = pot - prizes.reduce((a, b) => a + b, 0);
  const weights = players.map((p) => Math.max(0, p.cash));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const shares = players.map((_, i) =>
    weightSum > 0 ? Math.floor(vaultPot * (weights[i] / weightSum)) : Math.floor(vaultPot / players.length));
  // Rounding dust goes to the best-placed vault so the pot is paid in full.
  const dust = vaultPot - shares.reduce((a, b) => a + b, 0);
  const top = weights.indexOf(Math.max(...weights));
  shares[top >= 0 ? top : 0] += dust;
  players.forEach((p, i) => { out[p.key] = (prizes[i] + shares[i]) / 1e6; });
  return out;
}

/**
 * On-chain escrow record for an arena. Populated by escrow-server when
 * `escrowReady()` is true; undefined for ledger-only arenas. Carries across
 * `advance()` so every round in a rumble points at the same on-chain vault.
 */
export type RoundEscrowRecord = {
  host: string;         // operator pubkey that hosts every arena on chain
  roundVault: string;   // PDA holding the pool + player vaults
  seedBase64: string;
  initSignature: string;
  mint: string;
  history: string[];    // "Deposit ✓ <sig12>…" style entries
  settleSignatures?: string[];  // set after SettlePlayer + CloseSettlement
  /**
   * Username + opening call a wallet asked for when it requested its deposit
   * tx. If the deposit lands but the enroll request never arrives, the keeper
   * seats the wallet from its on-chain entry using these.
   */
  pendingSeats?: Record<string, { nickname: string; openingCall: Side | null; openingCallPct?: number; picks?: Picks }>;
};

/**
 * Oracle prices (USD) for a BTC/ETH/SOL direction round. `open` is taken
 * when trading opens, `close` at the deadline; the round's market resolves
 * UP if close > open. All three assets are recorded so parlay legs on the
 * other assets resolve over the same window.
 */
export type RoundOracle = {
  source: string;
  open: Record<string, number>;
  openAt: number;
  last?: Record<string, number>;
  lastAt?: number;
  close?: Record<string, number>;
  closeAt?: number;
};

export type Round = {
  id: string;
  /**
   * Arena code — the shareable identity a rumble series lives under. `PUBLIC`
   * is the walk-in bot lobby; anything else is a user-hosted room whose invite
   * link is `/a/{arenaCode}`. Carries across `advance()`.
   */
  arenaCode: string;
  config: RoundConfig;
  roundNumber: number;    // 1-indexed
  status: RoundStatus;
  entrants: Entrant[];
  prizePoolUsdc: number;
  createdAt: number;
  enrollDeadline: number; // ms epoch
  liveDeadline: number;   // ms epoch — 0 until live
  endedAt: number;        // ms epoch — set when complete/cancelled, else 0
  championId: string | null;
  history: string[];      // human-readable event log
  historyAt?: number[];   // ms epoch per history entry (0 = not recorded)
  oracle?: RoundOracle;   // direction rounds: open/last/close prices
  botTickAt?: number;     // ms — bots decide at a fixed pace, not once per page poll
  /** On-chain escrow record; undefined = ledger-only arena. */
  escrow?: RoundEscrowRecord;
  /** Predictions arena: the questions, and their answers once closed. */
  predictions?: PredictionsState;
};

/** The reserved code for the walk-in public arena that always has a live round. */
export const PUBLIC_ARENA = "PUBLIC";
/** Walk-in practice arena for the Predictions format. */
export const PICKS_PRACTICE_ARENA = "PICKS";

/** Free, ledger-only walk-in arenas that always have a round open. */
export function isPracticeArena(code: string): boolean {
  return code === PUBLIC_ARENA || code === PICKS_PRACTICE_ARENA;
}

/**
 * Generate a short shareable arena code — 6 chars from Crockford's base32
 * (no I/L/O/U to avoid confusion). Collision odds at 32^6 ≈ 1B are ample for
 * a game with a few thousand concurrent hosts, and short enough to type or
 * dictate over voice.
 */
export function newArenaCode(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export function normalizeArenaCode(raw: string | null | undefined): string {
  const c = (raw ?? "").toString().trim().toUpperCase();
  if (!c) return PUBLIC_ARENA;
  // Preserve PUBLIC verbatim; other codes are constrained to base32 chars.
  if (c === PUBLIC_ARENA) return PUBLIC_ARENA;
  return c.replace(/[^0-9A-Z]/g, "").slice(0, 8) || PUBLIC_ARENA;
}

// ── defaults ──────────────────────────────────────────────────────────

// Market-Royale seat model: every player funds one combined deposit that
// splits into an ENTRY (→ shared prize pool) and a starting VAULT (their own
// real trading balance, withdrawn at the end). startingBankroll IS the vault.
export const DEFAULT_CONFIG: RoundConfig = {
  marketId: "",
  marketQuestion: "",
  category: "crypto",
  asset: "SOL",
  format: "royale",
  host: "",
  entryUsdc: 2,          // → shared prize pool
  startingBankroll: 10,  // → your isolated trading vault (real, withdrawable)
  capacity: 8,
  minEntrants: 2,
  enrollmentSec: 30,
  liveSec: 180,
  roundLimit: 3
};

const BOT_NAMES = ["SIGNAL", "FADE", "HORIZON", "WEDGE", "GRANITE", "SPIRE", "VERTEX", "EMBER", "KESTREL", "ONYX"];

let idCounter = 0;
function uid(prefix: string) {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

// ── construction ──────────────────────────────────────────────────────

export function createRound(config: RoundConfig, roundNumber = 1, arenaCode: string = PUBLIC_ARENA): Round {
  const now = Date.now();
  return {
    id: uid("round"),
    arenaCode: normalizeArenaCode(arenaCode),
    config,
    roundNumber,
    status: "enrolling",
    entrants: [],
    prizePoolUsdc: 0,
    createdAt: now,
    enrollDeadline: now + config.enrollmentSec * 1000,
    liveDeadline: 0,
    endedAt: 0,
    championId: null,
    history: [`Round ${roundNumber} opened for enrollment.`],
    historyAt: [now]
  };
}

export function makeEntrant(round: Round, wallet: string, nickname: string, isBot = false): Entrant {
  return {
    id: uid("ent"),
    wallet,
    nickname,
    isBot,
    joinedAt: Date.now(),
    bankroll: round.config.startingBankroll,
    cash: round.config.startingBankroll,
    shares: 0,
    side: null,
    avgPrice: 0,
    eliminatedRound: null,
    rank: null,
    prizeUsdc: 0,
    parlays: []
  };
}

export function enroll(round: Round, entrant: Entrant): { ok: boolean; reason?: string } {
  if (round.status !== "enrolling") return { ok: false, reason: "Enrollment is closed." };
  if (round.entrants.length >= round.config.capacity) return { ok: false, reason: "Round is full." };
  if (round.entrants.some((e) => e.wallet === entrant.wallet)) return { ok: false, reason: "Already enrolled." };
  round.entrants.push(entrant);
  // Only real players fund the pool. Bots are seat-fillers (sponsor-backed
  // per the Market Royale model) and never inflate the prize.
  if (!entrant.isBot) round.prizePoolUsdc += round.config.entryUsdc;
  logEvent(round, `${entrant.nickname} entered (${round.entrants.length}/${round.config.capacity}).`);
  return { ok: true };
}

/** Fill the round with bots up to `target` entrants (default: capacity). */
export function fillWithBots(round: Round, target = round.config.capacity): void {
  if (round.status !== "enrolling" && round.status !== "live") return;
  const used = new Set(round.entrants.map((e) => e.nickname));
  const cap = Math.min(target, round.config.capacity);
  let i = 0;
  while (round.entrants.length < cap && i < BOT_NAMES.length) {
    const name = BOT_NAMES[i++];
    if (used.has(name)) continue;
    const bot = makeEntrant(round, `bot:${name.toLowerCase()}`, name, true);
    round.entrants.push(bot);           // bots don't fund the pool
    logEvent(round, `${name} entered (${round.entrants.length}/${round.config.capacity}).`);
    used.add(name);
  }
}

export function humanCount(round: Round): number {
  return round.entrants.filter((e) => !e.isBot).length;
}

/** Append to a round's activity log, stamped with when it happened. */
export function logEvent(round: Round, text: string, at = Date.now()): void {
  const times = (round.historyAt ??= []);
  // Rounds saved before times were recorded: their earlier lines are unknown (0).
  while (times.length < round.history.length) times.push(0);
  round.history.push(text);
  times.push(at);
}

/** Plain-language name of a side on the direction markets: YES = UP, NO = DOWN. */
export function sideWord(side: Side): "UP" | "DOWN" {
  return side === "YES" ? "UP" : "DOWN";
}

/** `nickname`, or `nickname_2`, `nickname_3`… if another entrant already uses it (case-insensitive). */
function uniqueNickname(round: Round, wallet: string, nickname: string): string {
  const taken = new Set(round.entrants.filter((e) => e.wallet !== wallet).map((e) => e.nickname.toLowerCase()));
  if (!taken.has(nickname.toLowerCase())) return nickname;
  for (let i = 2; i < 100; i++) {
    const suffix = `_${i}`;
    const candidate = nickname.slice(0, 16 - suffix.length) + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return nickname;
}

export type SeatOptions = {
  /** Deposit tx signature, logged in the escrow history. */
  signature?: string;
  openingCall?: Side | null;
  openingCallPct?: number;
  /** Predictions arena: the player's answers. */
  picks?: unknown;
  /**
   * Seated from an on-chain deposit whose enroll request never arrived
   * (dropped connection, closed tab). Doesn't restart the enrollment clock.
   */
  restored?: boolean;
};

/**
 * Seat a real player in an enrolling round. Shared by the enroll route and
 * the keeper's on-chain reconciliation so both apply the same rules.
 */
export function seatPlayer(round: Round, wallet: string, nickname: string, opts: SeatOptions = {}): { ok: true; entrant: Entrant } | { ok: false; reason: string } {
  if (round.status !== "enrolling") return { ok: false, reason: "Enrollment is closed for this round." };
  if (round.entrants.some((e) => e.wallet === wallet)) return { ok: false, reason: "Already enrolled." };
  const firstPlayer = humanCount(round) === 0;
  const name = uniqueNickname(round, wallet, (nickname || `${wallet.slice(0, 4)}_${wallet.slice(-4)}`).slice(0, 16));
  const entrant = makeEntrant(round, wallet, name, false);
  if (round.predictions) {
    entrant.picks = normalizePicks(round.predictions.questions, opts.picks);
    entrant.score = 0;
  } else {
    entrant.openingCall = opts.openingCall ?? null;
    entrant.openingCallPct = normalizeCallPct(opts.openingCallPct);
  }
  const res = enroll(round, entrant);
  if (!res.ok) return { ok: false, reason: res.reason ?? "Could not take a seat." };
  // A hosted arena's clock starts once its first seat (the host's) is
  // confirmed, so wallet approval time never eats into it.
  if (firstPlayer && !opts.restored && !isPracticeArena(round.arenaCode)) {
    round.enrollDeadline = Math.max(round.enrollDeadline, Date.now() + round.config.enrollmentSec * 1000);
  }
  // Practice arena: the first player's seat starts the countdown from now.
  if (firstPlayer && isPracticeArena(round.arenaCode)) {
    round.enrollDeadline = Date.now() + round.config.enrollmentSec * 1000;
  }
  if (round.escrow) {
    round.escrow.history.push(opts.signature
      ? `Deposit ${name} ✓ ${opts.signature.slice(0, 12)}…`
      : `Deposit ${name} ✓ seat matched to on-chain entry`);
  }
  return { ok: true, entrant };
}

/**
 * Public copy of a round for a given viewer. Opening calls and predictions
 * picks stay private while enrolling (only the viewer sees their own), and
 * the keeper's pending-seat notes are never sent to browsers.
 */
export function redactOpeningCalls(round: Round, viewer?: string | null): Round {
  const hideCalls = round.status === "enrolling";
  const entrants = hideCalls
    ? round.entrants.map((e) => {
      if (e.wallet === viewer || (!e.openingCall && !e.picks)) return e;
      // Keep how many questions are answered (not which way) so the room
      // can see who is ready.
      const answered = e.picks ? Object.fromEntries(Object.keys(e.picks).map((k) => [k, ""])) : undefined;
      return { ...e, openingCall: null, openingCallPct: undefined, picks: answered };
    })
    : round.entrants;
  const escrow = round.escrow?.pendingSeats
    ? (({ pendingSeats: _omit, ...rest }) => rest)(round.escrow)
    : round.escrow;
  return { ...round, entrants, escrow };
}

/** Opening-call sizes a player can pick (% of the vault). */
export const OPENING_CALL_SIZES = [25, 50, 100] as const;
export const DEFAULT_OPENING_CALL_PCT = 50;
export function normalizeCallPct(v: unknown): number {
  const n = Number(v);
  return (OPENING_CALL_SIZES as readonly number[]).includes(n) ? n : DEFAULT_OPENING_CALL_PCT;
}

/** Place every seated player's opening call (their chosen share of the vault) as the round goes live. */
export function placeOpeningCalls(round: Round, yesPrice: number): void {
  for (const e of round.entrants) {
    const call = e.openingCall;
    if (!call) continue;
    e.openingCall = null;
    if (e.isBot || e.shares > 0 || e.cash <= 0) continue;
    const price = call === "YES" ? yesPrice : 100 - yesPrice;
    const pct = e.openingCallPct ?? 100;
    const stake = Math.floor(e.cash * pct) / 100;
    if (buyShares(e, call, stake, price, yesPrice).ok) {
      logEvent(round, `${e.nickname} bought ${sideWord(call)} $${stake.toFixed(2)} at ${price}¢ (opening call).`);
    }
  }
}

// ── bankroll / trading ────────────────────────────────────────────────

// ── trading rules ─────────────────────────────────────────────────────

/**
 * Cents added to the buy price and taken off the sell price of a single
 * trade. Makes flipping sides cost something, so re-trading every small lag
 * in the price feed doesn't pay. Opening calls and settlement don't pay it.
 */
export const TRADE_SPREAD = 1;
/** Trading, parlays and cash-outs close this long before the deadline ("last call"). */
export const TRADE_CUTOFF_MS = 30_000;

export const buyPriceOf = (sideCents: number) => Math.min(99, Math.round(sideCents) + TRADE_SPREAD);
export const sellPriceOf = (sideCents: number) => Math.max(0, Math.round(sideCents) - TRADE_SPREAD);

/** Can players still trade in this round right now? */
export function tradingOpen(round: Round, now = Date.now()): boolean {
  return round.status === "live" && round.config.format !== "predictions" && now < round.liveDeadline - TRADE_CUTOFF_MS;
}

/**
 * Buy `usdc` of `side` at `priceCents` (the execution price, spread
 * included). Switching sides sells the current position first at the mark
 * less `spread`.
 */
export function buyShares(entrant: Entrant, side: Side, usdc: number, priceCents: number, markYesPrice: number, spread = 0): { ok: boolean; reason?: string } {
  if (entrant.eliminatedRound !== null) return { ok: false, reason: "Eliminated." };
  if (usdc <= 0) return { ok: false, reason: "Amount must be positive." };
  // Switching sides sells the current position first, so its value counts
  // towards what can be bought.
  if (usdc > availableFor(entrant, side, markYesPrice, spread) + 1e-9) return { ok: false, reason: "Insufficient bankroll." };
  const price = Math.max(1, Math.min(99, priceCents));

  if (entrant.side && entrant.side !== side && entrant.shares > 0) {
    liquidate(entrant, markYesPrice, spread);
  }
  usdc = Math.min(usdc, entrant.cash);
  const newShares = usdc / (price / 100);
  const prevCost = entrant.avgPrice * entrant.shares;
  entrant.shares += newShares;
  entrant.side = side;
  entrant.avgPrice = entrant.shares > 0 ? (prevCost + price * newShares) / entrant.shares : price;
  entrant.cash -= usdc;
  markToMarket(entrant, markYesPrice);
  return { ok: true };
}

/**
 * USDC a player can put on `side` now: cash, plus what the current position
 * sells for (mark less `spread`) if it's the other side.
 */
export function availableFor(entrant: Entrant, side: Side, markYesPrice: number, spread = 0): number {
  if (!entrant.side || entrant.side === side || entrant.shares <= 0) return entrant.cash;
  const mark = entrant.side === "YES" ? markYesPrice : 100 - markYesPrice;
  return entrant.cash + entrant.shares * (Math.max(0, mark - spread) / 100);
}

/**
 * Places paid from the prize pool: the winner alone in a duel (≤ 2 players
 * paid in), otherwise the top 3. Bots never take a paid place.
 */
export function paidPlaces(round: Round): number {
  const funded = round.config.entryUsdc > 0 ? Math.round(round.prizePoolUsdc / round.config.entryUsdc) : humanCount(round);
  return funded <= 2 ? 1 : Math.min(3, humanCount(round));
}

/** Sell the entire current position at the live mark, less `spread` (0 at settlement). */
export function liquidate(entrant: Entrant, markYesPrice: number, spread = 0): void {
  if (!entrant.side || entrant.shares <= 0) return;
  const mark = entrant.side === "YES" ? markYesPrice : 100 - markYesPrice;
  entrant.cash += entrant.shares * (Math.max(0, mark - spread) / 100);
  entrant.shares = 0;
  entrant.side = null;
  entrant.avgPrice = 0;
  markToMarket(entrant, markYesPrice);
}

/**
 * Fair value of an open parlay ticket right now: payout units × the product of
 * each leg's live side probability. Settled tickets return 0 — their payout
 * has already been credited to cash. Without a price map, legs are valued at
 * their entry price so the number stays stable between keeper ticks.
 */
export function parlayMarkValue(t: ParlayTicket, priceMap?: PriceMap): number {
  if (t.status !== "open") return 0;
  const prob = jointProbability(t.legs.map((leg) => {
    const yes = priceMap?.[leg.marketId];
    const sideNow = yes === undefined ? leg.entryPrice : leg.side === "YES" ? yes : 100 - yes;
    return { marketId: leg.marketId, side: leg.side, prob: Math.max(1, Math.min(99, sideNow)) / 100 };
  }));
  return t.shares * prob;
}

/** Recompute bankroll = cash + mark value of the single position + open parlays. */
export function markToMarket(entrant: Entrant, markYesPrice: number, priceMap?: PriceMap): void {
  const mark = entrant.side === "YES" ? markYesPrice : entrant.side === "NO" ? 100 - markYesPrice : 0;
  let parlayVal = 0;
  for (const t of entrant.parlays) parlayVal += parlayMarkValue(t, priceMap);
  entrant.bankroll = entrant.cash + entrant.shares * (mark / 100) + parlayVal;
}

/** Buy a parlay ticket from the vault. Stake (incl. variance fee) leaves cash. */
export function placeParlay(entrant: Entrant, ticket: ParlayTicket): { ok: boolean; reason?: string } {
  if (entrant.eliminatedRound !== null) return { ok: false, reason: "Eliminated." };
  if (!ticket.legs || ticket.legs.length < 2) return { ok: false, reason: "A parlay needs at least 2 legs." };
  if (ticket.stake <= 0) return { ok: false, reason: "Stake must be positive." };
  if (ticket.stake > entrant.cash + 1e-9) return { ok: false, reason: "Insufficient vault cash." };
  entrant.cash -= ticket.stake;
  entrant.parlays.push(ticket);
  return { ok: true };
}

/** Resolve every open parlay at the final prices, crediting winnings to cash. */
export function settleParlays(entrant: Entrant, priceMap: PriceMap): void {
  for (const t of entrant.parlays) {
    if (t.status !== "open") continue;
    let mult = 1;
    for (const leg of t.legs) {
      const yes = priceMap[leg.marketId] ?? leg.entryPrice;
      const sideFinal = leg.side === "YES" ? yes : 100 - yes;
      if (sideFinal > 50) continue;            // leg landed
      else if (sideFinal === 50) mult *= 0.5;  // dead heat → 50/50 fallback
      else { mult = 0; break; }                // leg missed → parlay is dead
    }
    t.settledPayout = t.shares * mult;
    t.status = mult === 0 ? "lost" : mult < 1 ? "void" : "won";
    entrant.cash += t.settledPayout;
  }
}

// ── bots ──────────────────────────────────────────────────────────────

/**
 * One bot decision tick. Bots keep ~40-70% of bankroll deployed, flip sides
 * on momentum, and occasionally take profit. Deterministic-ish randomness
 * keeps the roster lively without a real strategy.
 */
export function botTick(entrant: Entrant, markYesPrice: number): void {
  if (!entrant.isBot || entrant.eliminatedRound !== null) return;
  markToMarket(entrant, markYesPrice);
  const r = Math.random();
  if (entrant.shares > 0 && r < 0.25) {
    liquidate(entrant, markYesPrice); // take profit / cut
    return;
  }
  if (r < 0.55 && entrant.cash > 1) {
    const side: Side = Math.random() > 0.5 ? "YES" : "NO";
    const price = side === "YES" ? markYesPrice : 100 - markYesPrice;
    const spend = Math.min(entrant.cash, entrant.cash * (0.3 + Math.random() * 0.4));
    buyShares(entrant, side, spend, price, markYesPrice);
  }
}

// ── settlement ────────────────────────────────────────────────────────

/**
 * Settle the round at the given YES price (0..100). If the market has a
 * hard outcome, pass 100 for YES-win or 0 for NO-win; otherwise the live
 * mark is used (mark-to-market settlement). Ranks entrants by final
 * bankroll, breaking ties by earlier entry, and eliminates the bottom half.
 */
export function settle(round: Round, finalYesPrice: number, priceMap?: PriceMap): void {
  round.status = "settling";
  const finalMap: PriceMap = { ...(priceMap ?? {}), [round.config.marketId]: finalYesPrice };
  const alive = round.entrants.filter((e) => e.eliminatedRound === null);
  for (const e of alive) {
    settleParlays(e, finalMap);      // resolve open parlays at final prices
    liquidate(e, finalYesPrice);     // redeem all single-position shares
    markToMarket(e, finalYesPrice, finalMap);
  }
  // Rank: higher bankroll first; tie → earlier joinedAt.
  const ranked = [...alive].sort((a, b) => (b.bankroll - a.bankroll) || (a.joinedAt - b.joinedAt));
  ranked.forEach((e, i) => { e.rank = i + 1; });

  const survivorCount = Math.max(1, Math.ceil(ranked.length / 2));
  const survivors = ranked.slice(0, survivorCount);
  const cut = ranked.slice(survivorCount);
  for (const e of cut) e.eliminatedRound = round.roundNumber;

  const final = survivors.length <= 1 || round.roundNumber >= round.config.roundLimit;
  logEvent(round, final
    ? `Round ${round.roundNumber} settled — final standings are in.`
    : `Round ${round.roundNumber} settled — ${survivors.length} advance, ${cut.length} eliminated.`);

  if (final) {
    round.status = "complete";
    round.endedAt = Date.now();
    // Overall finishing order across ALL entrants, then split the shared pool
    // among the top HUMAN finishers (bots are sponsor-backed seat fillers and
    // never take real prize money).
    const order = finishingOrder(round);
    const humanWinners = order.filter((e) => !e.isBot).map((e) => e.id);
    const funded = round.config.entryUsdc > 0
      ? Math.round(round.prizePoolUsdc / round.config.entryUsdc)
      : humanWinners.length;
    const payouts = computePayouts(round.prizePoolUsdc, humanWinners.slice(0, 3), funded);
    for (const e of round.entrants) e.prizeUsdc = payouts[e.id] ?? 0;
    round.championId = humanWinners[0] ?? survivors[0]?.id ?? null;
    const champ = round.entrants.find((e) => e.id === round.championId);
    const champPrize = champ ? (payouts[champ.id] ?? 0) : 0;
    logEvent(round, champ
      ? `${champ.nickname} wins $${champPrize.toFixed(2)} from the $${round.prizePoolUsdc.toFixed(2)} pool.`
      : `Rumble complete.`);
  } else {
    round.status = "advancing";
  }
}

/**
 * Settle a Predictions round at the closing prices: score every player's
 * picks, rank by score, and split the pool among the best human scores —
 * players who tie share the places they cover equally.
 */
export function settlePredictions(round: Round, close: Record<string, number>): void {
  const st = round.predictions;
  const answers = answersFor(st?.questions ?? [], round.oracle?.open ?? {}, close);
  if (st) st.answers = answers;
  for (const e of round.entrants) e.score = scorePicks(e.picks, answers);
  for (const e of round.entrants) e.rank = scorePlace(round, e);
  const humans = standings(round).filter((e) => !e.isBot);
  const groups: Entrant[][] = [];
  for (const e of humans) {
    const last = groups[groups.length - 1];
    if (last && (last[0].score ?? 0) === (e.score ?? 0)) last.push(e);
    else groups.push([e]);
  }
  const funded = round.config.entryUsdc > 0 ? Math.round(round.prizePoolUsdc / round.config.entryUsdc) : humans.length;
  const payouts = computeGroupPayouts(round.prizePoolUsdc, groups.map((g) => g.map((e) => e.id)), funded);
  for (const e of round.entrants) e.prizeUsdc = payouts[e.id] ?? 0;

  round.status = "complete";
  round.endedAt = Date.now();
  const total = st?.questions.length ?? 0;
  if (st) logEvent(round, `Results: ${resultsLine(st.questions, answers)}.`);
  const top = groups[0] ?? [];
  round.championId = top[0]?.id ?? standings(round)[0]?.id ?? null;
  const won = top.reduce((s, e) => s + e.prizeUsdc, 0);
  if (humans.length === 1) {
    logEvent(round, `${humans[0].nickname} scored ${humans[0].score ?? 0}/${total} — the only player who paid in, so their $${won.toFixed(2)} entry comes back.`);
  } else if (top.length === 1) {
    logEvent(round, `${top[0].nickname} wins $${won.toFixed(2)} with ${top[0].score ?? 0}/${total} right.`);
  } else if (top.length > 1) {
    const names = top.length === 2 ? `${top[0].nickname} and ${top[1].nickname}` : `${top.length} players`;
    logEvent(round, `${names} tie on ${top[0].score ?? 0}/${total} and split $${won.toFixed(2)}.`);
  } else {
    logEvent(round, "Predictions complete.");
  }
}

/**
 * Overall finishing order across every entrant: survivors first, then whoever
 * was cut later, then higher final bankroll, then earlier entry. Used to award
 * the prize split at the final.
 */
export function finishingOrder(round: Round): Entrant[] {
  if (round.config.format === "predictions") return [...round.entrants].sort(byScore);
  return [...round.entrants].sort((a, b) => {
    const aAlive = a.eliminatedRound === null;
    const bAlive = b.eliminatedRound === null;
    if (aAlive !== bAlive) return aAlive ? -1 : 1;
    if (!aAlive && !bAlive && a.eliminatedRound !== b.eliminatedRound) {
      return b.eliminatedRound! - a.eliminatedRound!; // cut later = better finish
    }
    return (b.bankroll - a.bankroll) || (a.joinedAt - b.joinedAt);
  });
}

/**
 * What a player can withdraw from escrow. Mid-game: nothing. At the final:
 * their remaining vault plus any prize share. On recovery (cancelled): their
 * entry back plus whatever vault remains — the Market Royale fair-play rule.
 */
export function entitlementUsdc(round: Round, e: Entrant): number {
  if (e.isBot) return 0;
  if (round.status === "cancelled") return round.config.entryUsdc + e.cash;
  if (round.status === "complete") return e.cash + e.prizeUsdc;
  return 0;
}

/**
 * Promote survivors into a fresh round on a new market. Survivors CARRY the
 * bankroll they earned into the next round (Market Royale rule) — they do not
 * reset to the starting stack. The prize pool carries forward untouched.
 */
export function advance(round: Round, nextMarket: { marketId: string; marketQuestion: string; category: string; asset: string }): Round {
  const survivors = round.entrants.filter((e) => e.eliminatedRound === null);
  // Players cut in earlier rounds stay on the roster, frozen at the vault
  // they finished with: they still withdraw it at the final settlement and
  // still count in the overall finishing order.
  const knockedOut = round.entrants
    .filter((e) => e.eliminatedRound !== null)
    .map((e): Entrant => ({ ...e, bankroll: e.cash, shares: 0, side: null, avgPrice: 0, parlays: [], openingCall: null }));
  const next: Round = {
    id: uid("round"),
    arenaCode: round.arenaCode,
    config: { ...round.config, ...nextMarket },
    roundNumber: round.roundNumber + 1,
    status: "live",
    entrants: survivors.map((e): Entrant => ({
      ...e,
      bankroll: e.cash,   // carry forward the vault they earned
      cash: e.cash,
      shares: 0,
      side: null,
      avgPrice: 0,
      rank: null,
      prizeUsdc: 0,
      parlays: [],
      openingCall: null
    })).concat(knockedOut),
    prizePoolUsdc: round.prizePoolUsdc,
    createdAt: Date.now(),
    enrollDeadline: Date.now(),
    liveDeadline: Date.now() + round.config.liveSec * 1000,
    endedAt: 0,
    championId: null,
    history: [`Round ${round.roundNumber + 1} live — ${survivors.length} survivor${survivors.length === 1 ? "" : "s"} on ${nextMarket.asset}.`],
    historyAt: [Date.now()],
    escrow: round.escrow
  };
  return next;
}

// ── standings ─────────────────────────────────────────────────────────

/** Predictions order: more right answers first; tie → earlier entry. */
const byScore = (a: Entrant, b: Entrant) => ((b.score ?? 0) - (a.score ?? 0)) || (a.joinedAt - b.joinedAt);

/**
 * Place of each player counting ties (1, 1, 3…): one more than how many
 * scored strictly higher. Predictions only; other formats rank by order.
 */
export function scorePlace(round: Round, e: Entrant, humansOnly = false): number {
  return 1 + round.entrants.filter((x) => (!humansOnly || !x.isBot) && (x.score ?? 0) > (e.score ?? 0)).length;
}

export function standings(round: Round): Entrant[] {
  if (round.config.format === "predictions") return [...round.entrants].sort(byScore);
  return [...round.entrants].sort((a, b) => {
    if ((a.eliminatedRound === null) !== (b.eliminatedRound === null)) {
      return a.eliminatedRound === null ? -1 : 1; // alive first
    }
    return (b.bankroll - a.bankroll) || (a.joinedAt - b.joinedAt);
  });
}

export function cutLine(round: Round): number {
  const alive = round.entrants.filter((e) => e.eliminatedRound === null).length;
  return Math.max(1, Math.ceil(alive / 2)); // survivors after this round
}
