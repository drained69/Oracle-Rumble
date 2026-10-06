<div align="center">

# The Pit

**Trading pits on any prediction market — built on Panta, on Solana.**

Live at **[www.trythepit.xyz](https://www.trythepit.xyz)**

[![Solana](https://img.shields.io/badge/solana-devnet-9945FF?style=flat-square&labelColor=0a0b0f)](https://solana.com/docs)
[![Panta](https://img.shields.io/badge/panta-public--api-eab308?style=flat-square&labelColor=0a0b0f)](https://docs.panta.market/)
[![Next.js](https://img.shields.io/badge/next.js-15.5-black?style=flat-square&labelColor=0a0b0f)](https://nextjs.org)
[![Claude](https://img.shields.io/badge/oracle-claude-d97757?style=flat-square&labelColor=0a0b0f)](https://docs.claude.com)

</div>

---

A host opens a **pit** on a market — tonight's game, an election, a launch, or
BTC/ETH/SOL — and everyone who joins pays the same seat into a non-custodial
Solana escrow. Inside the pit the room trades **its own odds**, starting from
Panta's price. The best vaults split the pool; a royale cuts the bottom half
each round.

| Panta pitch | In The Pit |
|---|---|
| Host a pit on tonight's game | Host on any open Panta market, or create a new one on Panta from the host panel (quote → sign → register) |
| Creator / streamer mode | Join code + QR, invite link, and an OBS/Streamlabs overlay at `/a/CODE/overlay` |
| The arena is the terminal | Live price tape vs Panta's line, where the room's money sits, a book-aware trade ticket |
| The Oracle read | A read of the pit's own market data; the lean is computed, Claude phrases it |

Two call-contest formats — **Predictions** and **Streak** — run on crypto
prices with no trading.

## How a Panta pit works

1. **Market** — the host picks an open Panta market (`/api/markets/catalog`) or
   creates one. Creation runs Panta's `markets/create/quote` → `build` → **X
   wallet signature** → `markets/register`. The quote's fee is shown before
   anything is signed. Drafts are persisted (Postgres) and bound to the creating
   wallet, so a paid market survives a restart and only its creator can host on it.
2. **Seats** — players pay the seat into escrow and make a hidden YES/NO call.
   The host takes seat #1.
3. **Lock** — Panta's YES price becomes the opening line; every call fills there.
4. **Live** — the room trades against an LMSR book seeded at the line
   (`lib/room-book.ts`). Depth `b` = total vaults, clamped to 20–5,000. Every trade
   moves the price for the whole room and is recorded on the tape.
5. **Bell** — YES settles at the room's time-weighted average over the closing
   window (last 20% of the round, 30 s – 10 min), so the close can't be marked.
   If Panta resolves the market first, the pit settles at $1/$0 on the real
   outcome.
6. **Payout** — vaults are ranked, the prize split is recorded on-chain, and each
   player withdraws with their own signature.

## Game formats

| Format | Rounds | Trades? | How it ends |
|---|---|---|---|
| **Single** | 1 | yes | One trading window; ranked by final vault; pool paid to the top finishers. |
| **Royale** | 2–4 | yes | Bottom half (`ceil(alive/2)` survive) cut each round; survivors carry their vault forward until one remains or the round limit is hit. A Panta royale re-opens the book at the prior round's settlement price and trades the **same** market every round. |
| **Predictions** | 1 | no | Crypto only. Five hidden picks on BTC/ETH/SOL (three up/down, "which does best", one head-to-head); one point per right answer, optional 2–3 pick lock doubles those picks. Top scores paid. |
| **Streak** | up to 6 legs | no | Crypto only. One quick call per leg (20 s hidden pick window, 1/2/5-min legs); a wrong or missed pick knocks you out. Last caller standing wins. |

Settlement of a trading pit: **Panta market** → YES settles at the room's
time-weighted average over the closing window (last 20% of the round, clamped
30 s–10 min), or $1/$0 if Panta resolved the market first. **Crypto pit** →
UP/DOWN pays $1 if the asset closed higher/lower than its open (50¢ each way on
a dead-flat close), priced live from Coinbase spot with Kraken as backup.

## Money & fees

```
seat      = entry + vault                     (both deposited into escrow)
pool      = entry × players who paid
vault pot = vault × players who paid
prizes    = split of (pool − host fee)
withdraw  = prize share + vault pot × (your final vault ÷ Σ final vaults) − 0.1% claim fee
```

- **Prize split** — a duel (2 players) is winner-take-all; 3+ players split
  62.5% / 23.4375% / 14.0625%, 1st absorbing any rounding remainder. Ties share
  the places they cover.
- **Vault redistribution** — the players' vaults are shared out in proportion to
  how each finished, so one trader's losses fund another's gains. Escrow is always
  paid out in full; if every vault ends at $0 the vault money returns equally.
- **Host fee** — 0–5% of the pool, set by the host, paid into the host's seat at
  settlement, shown to players before they join. Cancelled pits pay none.
- **Platform fee** — 0.1% (10 bps), taken by the escrow program on each claim of a
  settled payout and capped in-program at 1% (100 bps). Refunds and recoveries are
  fee-free. Predictions/Streak carry a 1-unit (0.000001 USDC) vault, returned at
  settlement.
- **Market creation fee** — charged by Panta (not The Pit) from the quote, shown
  before signing; $0 on a sandbox key (empty build tx).

## Host settings (server-enforced ranges)

| Setting | Options / range |
|---|---|
| Market | Crypto · existing Panta market · new Panta market |
| Enrollment | Quick (2 min) · Scheduled (5 min – 3 hours, i.e. 20 s–10,800 s) |
| Game | Single · Royale (2–4 rounds) · Predictions · Streak (≤6 legs) |
| Trading window | Panta 5/15/60 min · Crypto 5/15 min or 1 h · Streak legs 1/2/5 min (`liveSec` 60–3,600 s) |
| Players | 2–16 |
| Entry | $1–$100 (whole USDC) |
| Vault | $5–$500 (whole USDC; none for Predictions/Streak) |
| Host fee | 0–5% |
| Opening call size | 25% / 50% (default) / 100% of the vault |

## Sign-in (X-only)

The only way in is **Sign in with X**. The flow (`lib/use-wallet.ts` →
`lib/session-client.ts` → `POST /api/auth/x`):

1. Privy runs the X OAuth redirect and creates (or reopens) a Solana **embedded
   wallet** for that X account.
2. The browser posts the Privy identity/access token plus the wallet address.
3. `lib/privy-server.ts` verifies the token against Privy's JWKS and confirms the
   wallet is that X account's own embedded wallet (`wallet_client_type: "privy"` /
   `connector_type: "embedded"`), using the app secret to re-fetch the user when a
   fresh token predates a just-created wallet.
4. `lib/profile-store.ts` sets the username to the X handle on first sign-in (one
   X account ↔ one wallet). A handle previously linked to an extension wallet
   **moves** to the X wallet, keeping its username.
5. An HMAC-signed session cookie (`or_session`, 7-day TTL) is issued for the wallet.

Wallet-signature sign-in (`/api/auth/challenge` + `/verify`, SIWS) is kept only
for **local dev without Privy** and is refused when `PRIVY_ENABLED` or in
production. On-chain deposits from a wallet with no X account are never
auto-seated — they are refunded in full at settlement. The account menu
(`app/AccountMenu.tsx`) shows the wallet address (copy/QR/explorer), USDC+SOL
balances, funding links, Privy key export, and sign-out.

## Architecture

```
Browser (Next.js 15 / React 19)
  ├─ sign in with X only → Privy embedded Solana wallet for that X account
  └─ X wallet signs: escrow deposit/claim/recover, Panta create tx
        │
Next.js server  app/api/*
  ├─ pit engine     lib/royale.ts · lib/round-keeper.ts  (Postgres or in-memory,
  │                 per-pit advisory locks)
  ├─ room book      lib/room-book.ts                     (LMSR, tape, TWAP)
  ├─ Panta          lib/panta-market.ts · lib/panta.ts   (markets, line, resolution,
  │                 creation drafts; API key never leaves the server)
  ├─ Oracle read    lib/market-read.ts · lib/oracle-ai.ts (signals → Claude headline)
  └─ escrow         lib/escrow-server.ts                 (operator opens vaults and
                    records entitlements; cannot move player funds)
        │
Solana   program/   non-custodial USDC escrow (deposit · settle · claim · recover)
```

### The Oracle read

`lib/market-read.ts` computes the signals (room vs Panta line, one-minute move,
session range, room positioning, time to bell) and decides the lean and
confidence. With `ANTHROPIC_API_KEY` set, `lib/oracle-ai.ts` asks
`claude-opus-5-5` (low effort, server-side refusal fallback) to phrase a
two-sentence headline. The host-written question is passed strictly as data and
the output is validated (length, no links or markup) before display. One read
per pit state is cached ~20 s and shared by every viewer. Seat calls are never
used while enrollment is open.

### Escrow program (`program/`)

A native `solana-program` (no Anchor) that holds each pit's seats in a
per-pit vault PDA. Funds move only through player-signed instructions:

| Instruction | Who signs | Effect |
|---|---|---|
| `InitRound` / `InitRoundV2` | operator | Open a pit vault; V2 carries the platform-fee config (`claim_fee_bps`, cap `MAX_CLAIM_FEE_BPS = 100`). |
| `Deposit` | player | Transfer the seat (entry + vault) into the vault. |
| `SettlePlayer` / `CloseSettlement` | operator | Record each player's final entitlement (≤ what was deposited). |
| `Claim` | player | Withdraw the recorded payout; the fee (if any) goes to the recipient, the rest to the player. |
| `CloseRefund` | operator | Cancelled pit → mark every deposit refundable, fee-free. |
| `Recover` | player | After `settle_deadline` with no settlement, reclaim the full seat, fee-free. |

The operator key opens vaults and records entitlements but **cannot move**
anyone's USDC; total entitlements can never exceed deposits. `settle_deadline`
is set at init to `now + (3 min + enrollment + roundLimit·(liveSec + 120) + 1 h)`.

## API surface

All server routes live under `app/api/*`; Panta's REST API is proxied
server-side so `PANTA_API_KEY` never reaches the browser. Key routes:

| Route | Purpose |
|---|---|
| `POST /api/auth/x` | Sign in: Privy proof of the X account + its wallet → session cookie |
| `GET /api/auth/session` | Who this browser is signed in as (wallet + X handle) |
| `GET /api/arenas` | Open pits (enrolling/live/settling/advancing) |
| `GET /api/round?arena=` | Round state, standings, cut line, YES price, Panta line, tape, spot |
| `POST /api/round` | Host a pit (signed in); `marketSource:"panta"` + `pantaMarketId`/`draftId` |
| `POST /api/round/{enroll,call,picks,trade,cancel}` | Seat, opening call, picks/leg, trade, cancel |
| `GET /api/round/read?arena=` | The Oracle read for a trading pit |
| `GET /api/markets/catalog` | Open Panta markets a pit can run on |
| `POST /api/markets/{quote,build,register}` | Create a Panta market (signed in) |
| `GET /api/escrow/{status,balance}` · `POST /api/escrow/{tx,settle}` | Mode, balances, unsigned txs, settlement |
| `GET /api/portfolio?wallet=` · `GET /api/positions?wallet=` | A wallet's pits / Panta positions |
| `POST /api/orders/{quote,build,submit,verify}` | Panta mirrored-order proxies |

## Development

```bash
npm install
cp .env.example .env.local   # fill what you need; everything is optional
npm run dev                  # http://localhost:3000
```

Players sign in **only with X**: `/api/auth/x` checks the Privy token, confirms the
wallet is that X account's own Privy embedded wallet, and issues the session.
Wallet-signature sign-in exists only for local development without Privy and is
refused in production. Without escrow keys the app runs in **practice mode** (no USDC moves). Without
`PANTA_API_KEY`, Panta pits are disabled and crypto pits still work.

| Variable | Purpose |
|---|---|
| `PANTA_API_KEY` | `pk_test_*` (sandbox: one test market, creation fee quoted but not charged) or `pk_live_*` |
| `PANTA_API_BASE` | Defaults to `https://live-api.panta.market/api/v1` |
| `PANTA_USER_ID` | Partner attribution (`X-User-Id`) |
| `NEXT_PUBLIC_SOLANA_RPC` / `NEXT_PUBLIC_SOLANA_CLUSTER` | Cluster for the app and escrow |
| `NEXT_PUBLIC_ESCROW_PROGRAM_ID` / `NEXT_PUBLIC_USDC_MINT` | Escrow program and USDC mint |
| `ESCROW_HOST_SECRET_KEY` | Operator key that opens vaults and records settlements (server only) |
| `PLATFORM_FEE_WALLET` | Receives the 0.1% claim fee (defaults to the operator) |
| `NEXT_PUBLIC_PRIVY_APP_ID` / `PRIVY_APP_SECRET` | **Required in production.** X sign-in (the only sign-in), X-handle usernames, each player's embedded wallet. Set the app secret too: it lets the server confirm a just-created wallet |
| `ANTHROPIC_API_KEY` | Claude phrasing for the Oracle read (optional) |
| `DATABASE_URL` | Postgres (in-memory when unset) |
| `SESSION_SECRET` | Signs the sign-in session cookie |
| `ROUND_HOST_SECRET` | Optional gate for forced round control |

## Deploy

Railway builds `main` (`railway.json`, `nixpacks.toml`). `NEXT_PUBLIC_*`
variables are baked in at build time — redeploy after changing them. The escrow
program and its deploy script live in [`program/`](program/README.md) and
[`scripts/deploy-escrow.sh`](scripts/deploy-escrow.sh).

## Layout

```
app/
  page.tsx, ArenasDirectory.tsx   lobby + host panel (market source, create market)
  a/[code]/                       a pit: ArenaView, ArenaStage, PitTerminal, CreatorKit
  a/[code]/overlay/               stream overlay (PitOverlay)
  docs/                           player & integrator docs (/docs)
  api/round/*                     pit engine: host, enroll, call, picks, trade, read
  api/markets/*                   Panta catalog + market creation (quote/build/register)
  api/escrow/*                    unsigned escrow txs, status, settlement
lib/
  royale.ts, round-keeper.ts      game rules and the round lifecycle
  room-book.ts                    LMSR book, tape, TWAP
  panta-market.ts                 Panta snapshots, catalog, creation drafts
  market-read.ts, oracle-ai.ts    the Oracle read
program/                          Solana escrow program (native solana-program)
```

The Pit is an independent product built on the Panta Public API for the Panta
API Sidetrack of the Colosseum hackathon.
