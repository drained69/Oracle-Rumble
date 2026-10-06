<div align="center">

# The Pit

**Trading pits on any prediction market — built on Panta, on Solana.**

Live at **[thepitv1.up.railway.app](https://thepitv1.up.railway.app)**

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
   creates one. Creation runs Panta's `markets/create/quote` → `build` → wallet
   signature → `markets/register`. The quote's fee is shown before anything is
   signed. Drafts are held server-side and bound to the creating wallet, so only
   the creator can host on a market they made.
2. **Seats** — players pay the seat into escrow and make a hidden YES/NO call.
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
