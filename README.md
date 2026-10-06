<div align="center">

# 🏟️ The Pit

### Trading pits on any prediction market — built on [Panta](https://www.panta.market/), on Solana.

**▶ Live:  [www.trythepit.xyz](https://www.trythepit.xyz)**  ·  **📖 Docs:  [/docs](https://www.trythepit.xyz/docs)**

[![Live](https://img.shields.io/badge/status-live_on_devnet-22c55e?style=flat-square&labelColor=0a0b0f)](https://www.trythepit.xyz)
[![Solana](https://img.shields.io/badge/solana-devnet-9945FF?style=flat-square&labelColor=0a0b0f)](https://solana.com/docs)
[![Panta](https://img.shields.io/badge/panta-public--api-eab308?style=flat-square&labelColor=0a0b0f)](https://docs.panta.market/)
[![Next.js](https://img.shields.io/badge/next.js-15.5-black?style=flat-square&labelColor=0a0b0f)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/typescript-5.9-3178c6?style=flat-square&labelColor=0a0b0f)](https://www.typescriptlang.org)
[![Privy](https://img.shields.io/badge/auth-privy_(X_only)-6a5cff?style=flat-square&labelColor=0a0b0f)](https://privy.io)
[![Claude](https://img.shields.io/badge/oracle-claude-d97757?style=flat-square&labelColor=0a0b0f)](https://docs.claude.com)

</div>

---

A host opens a **pit** on a market — tonight's game, an election, a token launch, or
BTC / ETH / SOL — and everyone who joins pays the same seat into a **non-custodial
Solana escrow**. Inside the pit the room trades **its own odds**, starting from
Panta's price: every buy and sell moves the line for everyone. The best vaults split
the pool when the bell rings; a *royale* cuts the bottom half each round until the
finalists remain.

The Pit is the **experience layer** for prediction markets. [Panta](https://www.panta.market/)
is the **market layer** — it supplies the markets, the opening price and the
resolution; The Pit wraps them in a fast, social, winner-takes-a-share game.

| The Panta pitch | What it becomes in The Pit |
|---|---|
| *Host a pit on tonight's game* | Host on any open Panta market, or **create a new market** on Panta from the host panel (quote → sign → register). |
| *Creator / streamer mode* | A join code, QR, invite link, and a transparent **OBS / Streamlabs overlay** at `/a/CODE/overlay`. |
| *The arena is the terminal* | A live price tape vs Panta's line, where the room's money sits, and a book-aware trade ticket. |
| *The Oracle read* | A running read of the pit's own market data — the lean is computed, **Claude** phrases it. |

Two call-contest formats — **Predictions** and **Streak** — run on live crypto
prices with no trading at all.

> **Devnet.** Everything runs on Solana **devnet** with Circle's test USDC. Test
> tokens have no monetary value. Flipping to mainnet is a configuration change
> (RPC + USDC mint + a `pk_live_` Panta key), gated on the usual legal/compliance review.

---

## Contents

- [Features](#features)
- [How a pit works](#how-a-pit-works)
- [Game formats](#game-formats)
- [Money and fees](#money-and-fees)
- [Host settings](#host-settings)
- [Sign-in (X-only)](#sign-in-x-only)
- [Architecture](#architecture)
- [Security and trust](#security-and-trust)
- [API surface](#api-surface)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Project structure](#project-structure)
- [Acknowledgements](#acknowledgements)

---

## Features

- **Pits on any market** — host on an open Panta market, spin up a brand-new one
  (sports, politics, culture, finance…), or trade BTC/ETH/SOL direction.
- **The room makes its own odds** — an on-chain-free LMSR book seeded at Panta's
  line; every trade moves the price for the whole room and is recorded on a live tape.
- **Four game modes** — Single, Royale (elimination), Predictions (5 hidden picks),
  and Streak (last caller standing).
- **Non-custodial USDC escrow** — a native Solana program holds every seat; only a
  player's own signature withdraws, and total payouts can never exceed deposits.
- **The Oracle read** — a shared, cached market read whose lean/confidence are
  computed deterministically and whose headline is phrased by Claude (optional).
- **Creator / streamer mode** — join code, QR, invite link, and a transparent
  browser-source overlay that leaks nothing hidden.
- **X-only sign-in** — one tap with X creates a Solana embedded wallet for that
  account; no extension, no seed phrase to start.
- **Zero-config local dev** — runs on an in-memory store with mock markets; add
  keys to enable Postgres, Panta, escrow, Privy and Claude incrementally.

---

## How a pit works

A trading pit on a Panta market, end to end:

1. **Market** — the host picks an open Panta market (`GET /api/markets/catalog`)
   or **creates one**. Creation runs Panta's `markets/create/quote` → `build` →
   **X-wallet signature** → `markets/register`; the fee is shown before anything is
   signed. Drafts are persisted (Postgres) and bound to the creating wallet, so a
   paid market survives a restart and only its creator can host on it.
2. **Seats** — players pay the seat (`entry + vault`) into escrow and make a hidden
   YES/NO opening call. The host takes seat #1.
3. **Lock** — when enrollment closes, Panta's YES price becomes the pit's opening
   line and every seat call fills there.
4. **Live** — the room trades against an **LMSR book** seeded at the line
   (`lib/room-book.ts`), depth `b = Σ vaults` clamped to 20–5,000. Every trade moves
   the price for everyone and is appended to the tape.
5. **Bell** — YES settles at the room's **time-weighted average** over the closing
   window (last 20% of the round, clamped 30 s – 10 min), so a last-second trade
   can't mark the close. If Panta resolves the market first, the pit settles $1/$0
   on the real outcome.
6. **Payout** — vaults are ranked, the prize split is recorded on-chain, and each
   player withdraws to their own wallet with their own signature.

Crypto pits follow the same lifecycle but price UP/DOWN from live spot instead of
a Panta book (see [Game formats](#game-formats)).

---

## Game formats

| Format | Rounds | Trades? | How it ends |
|---|---|:--:|---|
| **Single** | 1 | ✅ | One trading window; ranked by final vault; the pool pays the top finishers. |
| **Royale** | 2–4 | ✅ | After each round the bottom half is cut (`ceil(alive/2)` survive); survivors carry their vault forward until one remains or the round limit is hit. A Panta royale re-opens the book at the previous settlement price and trades the **same** market every round. |
| **Predictions** | 1 | ❌ | *Crypto only.* Five hidden picks on BTC/ETH/SOL (three up/down, "which does best", one head-to-head). One point per right answer; an optional 2–3 pick **lock** doubles those picks if they all land. Top scores paid. |
| **Streak** | up to 6 legs | ❌ | *Crypto only.* One quick call per leg (20 s hidden pick window, 1/2/5-min legs). A wrong or missed pick knocks you out — last caller standing wins. |

**Settlement.** *Panta pit* → YES settles at the room's TWAP over the closing
window, or $1/$0 if Panta resolved first. *Crypto pit* → UP/DOWN pays $1 if the
asset closed higher/lower than its open (50¢ each way on a dead-flat close), priced
live from **Coinbase** spot with **Kraken** as backup; if neither is reachable the
round settles 50¢/50¢.

---

## Money and fees

```text
seat      = entry + vault                       (both deposited into escrow)
pool      = entry × players who paid
vault pot = vault × players who paid
prizes    = split of (pool − host fee)
withdraw  = prize share + vault pot × (your final vault ÷ Σ final vaults) − 0.1% claim fee
```

- **Prize split** — a duel (2 players) is winner-take-all; 3+ players split
  **62.5% / 23.4375% / 14.0625%**, with 1st absorbing any rounding remainder. Tied
  players share the places they cover.
- **Vault redistribution** — players' vaults are shared out in proportion to how
  each finished, so one trader's losses fund another's gains. Escrow is always paid
  out in full; if every vault ends at $0 the vault money returns equally.
- **Host fee** — **0–5%** of the pool, set by the host, paid into the host's seat at
  settlement and shown to players before they join. Cancelled pits pay none.
- **Platform fee** — **0.1%** (10 bps), taken by the escrow program on each claim of
  a settled payout, capped in-program at **1%** (100 bps). Refunds and recoveries
  are fee-free. Predictions/Streak carry a 1-unit (0.000001 USDC) vault, returned at
  settlement.
- **Market-creation fee** — charged by **Panta** (not The Pit) per the quote and
  shown before you sign; **$0** on a sandbox key (the build tx is empty).

---

## Host settings

Server-enforced ranges (`HOST_LIMITS` in `lib/royale.ts`):

| Setting | Options / range |
|---|---|
| Market | Crypto · existing Panta market · new Panta market |
| Enrollment | Quick (2 min) · Scheduled (5 min – 3 hours; `enrollmentSec` 20 s–10,800 s) |
| Game | Single · Royale (2–4 rounds) · Predictions · Streak (≤ 6 legs) |
| Trading window | Panta 5/15/60 min · Crypto 5/15 min or 1 h · Streak legs 1/2/5 min (`liveSec` 60–3,600 s) |
| Players | 2–16 |
| Entry | $1–$100 (whole USDC) |
| Vault | $5–$500 (whole USDC; none for Predictions/Streak) |
| Host fee | 0–5% |
| Opening call size | 25% / 50% (default) / 100% of the vault |

Creating a market additionally validates: question 10–200 chars ending in `?`,
a category, a resolution rule 20–2,048 chars, 1–5 `http(s)` sources of truth, and a
trading window of 10 minutes – 1 year. Duplicate questions are refused.

---

## Sign-in (X-only)

The only way in is **Sign in with X**. The flow
(`lib/use-wallet.ts` → `lib/session-client.ts` → `POST /api/auth/x`):

1. **Privy** runs the X OAuth redirect and creates (or reopens) a Solana **embedded
   wallet** for that X account.
2. The browser posts the Privy identity/access token plus the wallet address.
3. `lib/privy-server.ts` verifies the token against Privy's JWKS and confirms the
   wallet is that X account's own embedded wallet (`wallet_client_type: "privy"` /
   `connector_type: "embedded"`), falling back to a server-side user lookup (app
   secret) when a fresh token predates a just-created wallet.
4. `lib/profile-store.ts` sets the username to the X handle on first sign-in — one X
   account ↔ one wallet. A handle previously linked to an extension wallet **moves**
   to the X wallet, keeping its username.
5. An HMAC-signed session cookie (`or_session`, 7-day TTL, host-bound) is issued.

Wallet-signature sign-in (`/api/auth/challenge` + `/verify`, SIWS) exists **only for
local dev without Privy** and is refused when `PRIVY_ENABLED` or in production.
On-chain deposits from a wallet with no X account are never auto-seated — they are
refunded in full at settlement. The account menu (`app/AccountMenu.tsx`) shows the
wallet address (copy / QR / explorer), USDC + SOL balances, funding links, Privy
private-key export, and sign-out.

---

## Architecture

```text
Browser (Next.js 15 · React 19 · TypeScript)
  ├─ sign in with X only → Privy embedded Solana wallet for that X account
  └─ X wallet signs: escrow deposit/claim/recover, Panta create tx
        │  (session cookie, host-bound)
Next.js server  (app/api/*)
  ├─ pit engine     lib/royale.ts · lib/round-keeper.ts   Postgres or in-memory,
  │                                                        per-pit advisory locks
  ├─ room book      lib/room-book.ts                       LMSR, tape, TWAP
  ├─ Panta          lib/panta-market.ts · lib/panta.ts     markets, line, resolution,
  │                                                         creation drafts (key stays server-side)
  ├─ Oracle read    lib/market-read.ts · lib/oracle-ai.ts  signals → Claude headline
  ├─ auth           lib/privy-server.ts · lib/session.ts   X verification, session cookie
  └─ escrow         lib/escrow-server.ts                   operator opens vaults &
                                                            records entitlements; cannot move funds
        │  (unsigned txs → wallet signs → app broadcasts)
Solana  (program/)  non-custodial USDC escrow — deposit · settle · claim · recover
```

**Stack:** Next.js 15 App Router, React 19, TypeScript 5.9, Postgres (`pg`), Privy
(`@privy-io/react-auth`), `@solana/web3.js` + `@solana/kit`, Anthropic SDK, a native
`solana-program` escrow. Deployed on Railway.

### The Oracle read

`lib/market-read.ts` computes the signals — room vs Panta line, one-minute move,
session range, room positioning, time to the bell — and decides the **lean** and
**confidence** deterministically. With `ANTHROPIC_API_KEY` set, `lib/oracle-ai.ts`
asks `claude-opus-5-5` (low effort, server-side refusal fallback) to phrase a
two-sentence headline that must agree with the computed lean. The host-written
question is passed strictly as data (prompt-injection hardened), and the output is
validated (length, no links or markup) before display. One read per pit state is
cached ~20 s and shared by every viewer; seat calls are never used while enrollment
is open.

### Escrow program (`program/`)

A native `solana-program` (no Anchor) that holds each pit's seats in a per-pit vault
PDA. Funds move only through the instructions below; player-facing ones require the
player's signature.

| Instruction | Who signs | Effect |
|---|---|---|
| `InitRound` / `InitRoundV2` | operator | Open a pit vault. V2 carries the platform-fee config (`claim_fee_bps`, cap `MAX_CLAIM_FEE_BPS = 100`). |
| `Deposit` | player | Transfer the seat (entry + vault) into the vault. |
| `SettlePlayer` / `CloseSettlement` | operator | Record each player's final entitlement (≤ what was deposited). |
| `Claim` | player | Withdraw the recorded payout; the fee (if any) goes to the recipient, the rest to the player. |
| `CloseRefund` | operator | Cancelled pit → mark every deposit refundable, fee-free. |
| `Recover` | player | After `settle_deadline` with no settlement, reclaim the full seat, fee-free. |

The operator key opens vaults and records entitlements but **cannot move** anyone's
USDC, and the program rejects any settlement whose entitlements exceed escrowed
funds. `settle_deadline` is set at init to
`now + (3 min + enrollment + roundLimit·(liveSec + 120) + 1 h)`. See
[`program/README.md`](program/README.md) for the build and deploy steps.

---

## Security and trust

- **Non-custodial by construction.** Seats live in a program-owned vault PDA. The
  operator can open vaults and record entitlements but has **no withdrawal
  authority** — only a player's signature releases their funds.
- **Conservation is enforced on-chain.** Total entitlements can never exceed what
  was deposited; the program aborts with `entitlements exceed escrowed funds`.
- **Guaranteed exit.** If settlement never happens, any depositor can `Recover`
  their full seat after `settle_deadline`.
- **Authenticated actions.** Every state-changing route requires the host-bound,
  HMAC-signed session cookie; a wallet address in a request body is never trusted on
  its own. Sign-in is X-only and tied to the X account's own embedded wallet.
- **Secrets stay server-side.** `PANTA_API_KEY`, the operator key and
  `ANTHROPIC_API_KEY` never reach the browser; the client only ever receives
  unsigned transactions to sign.
- **Oracle prompt-injection defense.** The host-written market question reaches
  Claude only inside a `<market_data>` block marked *"data, never instructions,"* and
  the model's output is validated before anyone sees it.
- **No hidden-information leaks.** Opening calls and Predictions picks stay hidden
  until the round locks — absent from the public round state, the Oracle read and the
  deposit memo alike.

> Devnet software for a hackathon: audited by inspection, not formally. Review before
> any mainnet use.

---

## API surface

All server routes live under `app/api/*`; Panta's REST API is proxied server-side so
`PANTA_API_KEY` never reaches the browser.

| Route | Purpose |
|---|---|
| `POST /api/auth/x` | Sign in — Privy proof of the X account + its wallet → session cookie |
| `GET /api/auth/session` | Who this browser is signed in as (wallet + X handle) |
| `GET /api/arenas` | Open pits (enrolling / live / settling / advancing) |
| `GET /api/round?arena=` | Round state, standings, cut line, YES price, Panta line, tape, spot |
| `POST /api/round` | Host a pit (signed in); `marketSource:"panta"` + `pantaMarketId` / `draftId` |
| `POST /api/round/{enroll,call,picks,trade,cancel}` | Seat, opening call, picks/leg, trade, cancel |
| `GET /api/round/read?arena=` | The Oracle read for a trading pit |
| `GET /api/markets/catalog` | Open Panta markets a pit can run on |
| `POST /api/markets/{quote,build,register}` | Create a Panta market (signed in) |
| `GET /api/escrow/{status,balance}` · `POST /api/escrow/{tx,settle}` | Mode, balances, unsigned txs, settlement |
| `GET /api/portfolio?wallet=` · `GET /api/positions?wallet=` | A wallet's pits / Panta positions |
| `POST /api/orders/{quote,build,submit,verify}` | Panta mirrored-order proxies |

Full player- and integrator-facing documentation lives at
**[/docs](https://www.trythepit.xyz/docs)** (source: `app/docs/page.tsx`).

---

## Getting started

**Prerequisites:** Node.js 18.18+ (20 LTS recommended) and npm.

```bash
git clone https://github.com/drained69/the-pit.git
cd the-pit
npm install
cp .env.example .env.local     # optional — the app runs with zero config
npm run dev                    # http://localhost:3000
```

With **no** environment variables the app runs fully in **practice mode**: an
in-memory store, mock markets, no USDC movement, and (because Privy is off) the
local dev wallet sign-in. Add keys to light up each layer:

| To enable | Set |
|---|---|
| Persistence across restarts | `DATABASE_URL` (Postgres) |
| Real Panta markets & creation | `PANTA_API_KEY` (+ `PANTA_USER_ID`) |
| On-chain USDC escrow | `NEXT_PUBLIC_ESCROW_PROGRAM_ID`, `NEXT_PUBLIC_USDC_MINT`, `ESCROW_HOST_SECRET_KEY` |
| X-only sign-in & embedded wallets | `NEXT_PUBLIC_PRIVY_APP_ID` (+ `PRIVY_APP_SECRET`) |
| Claude-phrased Oracle read | `ANTHROPIC_API_KEY` |

### Scripts

| Command | Does |
|---|---|
| `npm run dev` | Start the dev server (hot reload) |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | Type-check the whole project (`tsc --noEmit`) |
| `npm run seed:devnet` | Seed curated Panta markets on devnet (`scripts/seed-markets.mjs`) |
| `npm run seed:dry` | Dry-run the seeder (no writes) |

---

## Configuration

Every variable is optional for local dev; see the table above for what each unlocks.

| Variable | Purpose |
|---|---|
| `PANTA_API_KEY` | `pk_test_*` (sandbox: one test market, fee quoted but not charged) or `pk_live_*` |
| `PANTA_API_BASE` | Defaults to `https://live-api.panta.market/api/v1` |
| `PANTA_USER_ID` | Partner attribution (`X-User-Id` on Panta calls) |
| `NEXT_PUBLIC_SOLANA_RPC` / `NEXT_PUBLIC_SOLANA_CLUSTER` | Cluster for the app and escrow |
| `NEXT_PUBLIC_ESCROW_PROGRAM_ID` / `NEXT_PUBLIC_USDC_MINT` | Escrow program and USDC mint |
| `ESCROW_HOST_SECRET_KEY` | Operator key that opens vaults and records settlements (server only) |
| `PLATFORM_FEE_WALLET` | Receives the 0.1% claim fee (defaults to the operator) |
| `NEXT_PUBLIC_PRIVY_APP_ID` / `PRIVY_APP_SECRET` | **Required in production.** X sign-in (the only sign-in), X-handle usernames, each player's embedded wallet. Set the app secret so the server can confirm a just-created wallet. |
| `ANTHROPIC_API_KEY` | Claude phrasing for the Oracle read (optional; falls back to the computed read) |
| `DATABASE_URL` | Postgres (in-memory when unset) |
| `SESSION_SECRET` | Signs the session cookie (falls back to the operator key) |
| `ROUND_HOST_SECRET` | Optional gate for operator-forced round control |

> `NEXT_PUBLIC_*` values are inlined at build time — rebuild/redeploy after changing them.

---

## Deployment

Railway builds and deploys `main` on push (`railway.json`, `nixpacks.toml`). The live
site is served from a custom domain (`www.trythepit.xyz`) with the bare apex
redirecting to it. The escrow program and its deploy script live in
[`program/`](program/README.md) and
[`scripts/deploy-escrow.sh`](scripts/deploy-escrow.sh). Remember to set the
production environment variables — especially `NEXT_PUBLIC_PRIVY_APP_ID` /
`PRIVY_APP_SECRET` and the escrow keys — and to add the production domain to Privy's
allowed origins, or X sign-in will fail there.

---

## Project structure

```text
app/
  page.tsx, ArenasDirectory.tsx   lobby + host panel (market source, create market)
  a/[code]/                       a pit: ArenaView, ArenaStage, PitTerminal, CreatorKit
  a/[code]/overlay/               stream overlay (PitOverlay)
  docs/                           player & integrator docs (/docs)
  AccountMenu.tsx, SiteHeader.tsx header, X sign-in, wallet view
  api/auth/*                      X sign-in (auth/x), session
  api/round/*                     pit engine: host, enroll, call, picks, trade, read
  api/markets/*                   Panta catalog + market creation (quote/build/register)
  api/escrow/*                    unsigned escrow txs, status, balance, settlement
lib/
  royale.ts, round-keeper.ts      game rules and the round lifecycle
  room-book.ts                    LMSR book, price tape, TWAP settlement
  panta-market.ts, panta.ts       Panta snapshots, catalog, creation drafts, proxy
  market-read.ts, oracle-ai.ts    the Oracle read (signals + Claude)
  privy-server.ts, session.ts     X verification + host-bound session cookie
  profile-store.ts                X-handle usernames (one account ↔ one wallet)
  escrow-server.ts                escrow tx builders, settlement, balances
program/                          Solana escrow program (native solana-program)
scripts/                          devnet market seeder, escrow deploy
```

---

## Acknowledgements

Built on the **[Panta Public API](https://docs.panta.market/)** for the Panta API
Sidetrack of the **Colosseum** hackathon. Powered by **Solana**, wallet + auth by
**[Privy](https://privy.io)**, and the Oracle read phrased by **[Claude](https://www.anthropic.com)**.

The Pit is an independent project and is not affiliated with Panta. Devnet software
for a hackathon — not yet licensed for reuse, and not audited for mainnet.
