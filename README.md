<div align="center">

# ⚔ Oracle Rumble

**A game lobby for prediction markets on Solana.**

Pick a ring. Stake conviction on live [Panta](https://docs.panta.market/) markets. Stack legs into a parlay. Carve your name into the hall.

[![Deployed on Railway](https://img.shields.io/badge/live-oracle--rumble-6fe5a1?style=flat-square)](https://oracle-rumble-production.up.railway.app)
[![Next.js 15](https://img.shields.io/badge/next.js-15.5-black?style=flat-square)](https://nextjs.org)
[![Solana](https://img.shields.io/badge/solana-devnet-9945FF?style=flat-square)](https://solana.com/docs)
[![Panta](https://img.shields.io/badge/panta-live-d4a24c?style=flat-square)](https://docs.panta.market/)

**[Live demo →](https://oracle-rumble-production.up.railway.app)**

</div>

---

## Overview

Oracle Rumble is the **experience layer** for prediction markets — [Panta](https://www.panta.market/) is the **market layer**. Instead of trading in isolation, players enter themed **rings** (rumbles), take YES/NO positions from their wallet, and climb a wallet-scoped leaderboard. Every buy, claim, market creation, and attribution runs the real Panta lifecycle on Solana.

The frontend is a Next.js 15 app on Railway; every server route in `/api/*` is a typed 1:1 proxy over Panta's REST surface with a mock fallback for local dev.

---

## Features

| | |
| :-- | :-- |
| 🎮 **Game lobby UI** | Cinzel + JetBrains Mono typography, bracketed ornate frames, gold / jade / ember palette, live scrolling ticker |
| 🎯 **Real Panta markets** | Server-driven arenas grouped by category — no seed data leaks into live mode |
| 🥊 **Native parlays** | 2 – 5 legs, correlation blocks on mutually exclusive outcomes, variance-based fee (`stake × 5% × 4p(1-p)`), 50/50 fallback payout preview |
| 💧 **Quote-based liquidity** | `POST /api/parlay/quote` re-prices the slip from live single-market book on every leg change |
| 🔐 **Real Solana signing** | `@solana/web3.js` deserializes Panta's `VersionedTransaction`, hands it to Phantom / Backpack / Solflare, broadcasts to devnet, polls for confirmation |
| 🏛 **Wallet-scoped hall** | Positions and P&L read from `/positions?wallet=…` — no fabricated leaderboard entries |
| 🎲 **Host a rumble** | Full `create/quote → create/build → sign → register` flow to deploy real USDC markets on Panta |
| 🌱 **Market seeder** | `npm run seed:devnet` batch-creates markets from `scripts/curated-markets.json` |
| ⚡ **Live trade tape** | `/api/markets/{id}/trades` refreshed every 8 s, rendered under the wager panel |
| 🎫 **Attribution** | `POST /trades/report` credits every trade to your Panta partner key |

---

## Live at

**[oracle-rumble-production.up.railway.app](https://oracle-rumble-production.up.railway.app)** · Solana **devnet** · Panta test API (`pk_test_*`)

---

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  Browser (React 19, client component)                         │
│  ─ Wallet: Phantom / Backpack / Solflare via @solana/web3.js  │
│  ─ Parlay engine: lib/parlay.ts (2–5 legs, variance fee)      │
│  ─ State: React + localStorage (positions, parlays, drafts)   │
└───────────────────────────────────────────────────────────────┘
                    │  (fetch)
                    ▼
┌───────────────────────────────────────────────────────────────┐
│  Next.js Route Handlers  (/app/api/*)                         │
│  ─ 15 typed proxies over Panta                                │
│  ─ X-Api-Key injection · never touches the browser bundle     │
│  ─ Deterministic mock fallback when PANTA_API_KEY is empty    │
└───────────────────────────────────────────────────────────────┘
                    │  (X-Api-Key)
                    ▼
┌───────────────────────────────────────────────────────────────┐
│  Panta REST API   (live-api.panta.market/api/v1)              │
│  ─ /markets, /orders, /positions, /claims, /trades, …         │
└───────────────────────────────────────────────────────────────┘
                    │  (VersionedTransaction)
                    ▼
┌───────────────────────────────────────────────────────────────┐
│  Solana devnet RPC                                            │
│  ─ Wallet signs, broadcasts, RPC returns signature            │
│  ─ Panta observes confirmation, /orders/verify reports back   │
└───────────────────────────────────────────────────────────────┘
```

---

## Panta API surface

Every route below is implemented as a Next.js proxy under `app/api/`. The Panta API key never leaves the server. Missing key ⇒ deterministic mock fallback so the app is fully usable on a fresh clone.

### 📚 Catalog

| Oracle Rumble | Panta |
| :-- | :-- |
| `GET /api/markets` | `GET /markets/` |
| `GET /api/markets/[id]` | `GET /markets/{id}/` |
| `GET /api/markets/[id]/trades` | `GET /markets/{id}/trades/` |
| `GET /api/categories` | `GET /markets/categories/` |

### ⚔ Trading lifecycle

| Oracle Rumble | Panta |
| :-- | :-- |
| `POST /api/orders/quote` | `POST /orders/quote/` |
| `POST /api/orders/build` | `POST /orders/build/` |
| `POST /api/orders/submit` | `POST /orders/submit/` |
| `POST /api/orders/verify` | `POST /orders/verify/` |
| `POST /api/trades/report` | `POST /trades/report/` |
| `POST /api/parlay/quote` | *client-space — refreshes each leg from `/markets/{id}/`* |

### 🏛 Positions & claims

| Oracle Rumble | Panta |
| :-- | :-- |
| `GET /api/positions?wallet=` | `GET /positions/?wallet=` |
| `POST /api/claims/build` | `POST /claims/build/` |

### 🎲 Market creation

| Oracle Rumble | Panta |
| :-- | :-- |
| `POST /api/markets/quote` | `POST /markets/create/quote/` |
| `POST /api/markets/build` | `POST /markets/create/build/` |
| `POST /api/markets/register` | `POST /markets/register/` |

---

## Native parlays — the mechanics

Inspired by [parlayit.gg](https://docs.parlayit.gg/); implemented in [`lib/parlay.ts`](lib/parlay.ts).

- **2 ≤ legs ≤ 5.** `PARLAY_MIN_LEGS` / `PARLAY_MAX_LEGS`. Enforced client-side on add and server-side on quote.
- **Correlation blocks.** Legs that share a `correlationGroup` (e.g. `fn-main-outcome` for KO vs Decision) are mutually exclusive. Duplicates rejected.
- **Variance-based fee.** Per-leg fee is `stake × 5% × 4p(1-p)`. Peaks at coinflip legs, near-zero for high-conviction legs. Aggregate capped at 5%.
- **50/50 fallback.** A voided leg pays 0.5×; the parlay payout halves once per voided leg. The slip shows both all-hit and one-void outcomes.
- **Quote-based liquidity.** `/api/parlay/quote` refreshes every leg's price from Panta on every debounced change. No pre-listed parlay market.
- **Placement.** A parlay is placed as N linked `primary_order_usdc` orders sharing a client `parlayId`. Every leg runs the full lifecycle in parallel.

---

## Real Solana signing

`lib/panta-client.ts` uses [`@solana/web3.js`](https://github.com/solana-labs/solana-web3.js) (lazy-imported so the demo path stays under 130 kB first-load JS) to:

1. Deserialize Panta's base64 `transaction` payload into a `VersionedTransaction`.
2. Hand it to the connected wallet — Phantom, Backpack, or Solflare — via `signAndSendTransaction`, or fall back to `signTransaction` + `Connection.sendRawTransaction`.
3. Poll `getSignatureStatus` on `NEXT_PUBLIC_SOLANA_RPC` until `confirmed` or `finalized` (30 s timeout).
4. Report the signature to Panta via `/api/orders/submit` and `/api/trades/report`.

Every failure path throws (`WalletUnavailableError`, `WalletSignatureError`) — there is **no mock-signature safety net**. A wallet must be present and must sign, or the trade lifecycle fails loudly.

---

## Development

```bash
# 1. Install
npm install

# 2. Optional: point at real Panta (see .env.example)
cp .env.example .env.local
#    fill PANTA_API_KEY=pk_test_… — grab one from docs.panta.market

# 3. Dev
npm run dev           # http://localhost:3000

# 4. Type-check
npm run lint          # tsc --noEmit

# 5. Production build
npm run build && npm run start
```

Without a `PANTA_API_KEY`, every server route falls back to deterministic mock data — the full UI still renders and every button still works.

### Environment

| Variable | Purpose |
| :-- | :-- |
| `PANTA_API_KEY` | `pk_test_*` for devnet, `pk_live_*` for mainnet |
| `PANTA_API_BASE` | Defaults to `https://live-api.panta.market/api/v1` |
| `PANTA_ATTRIBUTION_KEY` | Partner attribution key for `/trades/report` |
| `NEXT_PUBLIC_SOLANA_RPC` | Client-side RPC (defaults to `https://api.devnet.solana.com`) |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | UI label — `devnet`, `testnet`, or `mainnet-beta` |

---

## Shipping more markets

Populate Panta with a curated batch of markets via the built-in seeder.

```bash
# Dry run — hits Panta, verifies quotes, doesn't sign or register
npm run seed:dry

# Full lifecycle — signs with your Solana keypair, broadcasts to devnet,
# registers with Panta.
export PANTA_API_KEY=pk_test_…
npm run seed:devnet -- --keypair ~/.config/solana/id.json
```

Edit [`scripts/curated-markets.json`](scripts/curated-markets.json) to change the questions. Each entry must include:

- `question` (≤ 512 chars)
- `resolutionRule` (≤ 2048 chars)
- `sourcesOfTruth` (1–20 URLs)
- `category` — one of `sports`, `crypto`, `politics`, `entertainment`, `finance`, `science`, `world`, `other`
- `imageUrl` (http/https, ≤ 2048 chars)
- `endTime` (ISO 8601)

> **Sandbox note.** With a `pk_test_*` key, Panta returns a fixed sandbox fixture — every quote yields the same `createId` and every registration collapses onto the single `TestMarket1111…` pubkey. The seeder still walks the full pipeline so a swap to `pk_live_*` needs no code change.

---

## Deploy (Railway)

The repo ships with a Nixpacks plan and `railway.json` — one command to production.

```bash
railway up --service oracle-rumble
```

- [`nixpacks.toml`](nixpacks.toml) pins Node 20 and runs `npm ci` → `npm run build` → `npm run start`.
- [`railway.json`](railway.json) sets the `/` healthcheck, a 100 s startup budget, and an on-failure restart policy with 3 retries.

Set environment variables via `railway variables --set K=V` or the service Variables tab. Railway auto-redeploys on env change.

---

## Repo layout

```
app/
  layout.tsx               root metadata
  page.tsx                 game-lobby UI (client component, ~1200 lines)
  globals.css              theme + layout
  api/
    categories/            allowlist of Panta categories
    claims/build/          claim_win_usdc proxy
    markets/               list + [id] single + [id]/trades tape
      quote/               market-create quote
      build/               market-create build
      register/            market-create register
    orders/                quote → build → submit → verify
    parlay/quote/          dynamic parlay pricing
    positions/             wallet-scoped positions
    trades/report/         partner attribution
lib/
  arena-data.ts            types + optional seed fallback (empty in production)
  panta.ts                 server-side Panta client + types
  panta-client.ts          browser helpers + real Solana signing
  parlay.ts                parlay math — variance fee · correlation · 50/50
scripts/
  seed-markets.mjs         batch market seeder
  curated-markets.json     8 seeded questions
nixpacks.toml              Railway build plan
railway.json               Railway deploy config
```

---

## Credits

- **Panta** — the market layer. [docs](https://docs.panta.market/) · [website](https://www.panta.market/) · [playground](https://github.com/Kaito-HQ/panta-api-playground)
- **Solana** — settlement. [docs](https://solana.com/docs) · ~400 ms slot times · USDC 1:1
- **ParlayIt** — parlay mechanics inspiration. [docs](https://docs.parlayit.gg/)
- **Next.js 15**, **React 19**, **@solana/web3.js**, **Cinzel**, **JetBrains Mono**

---

<div align="center">

**Oracle Rumble** · *Call it. Prove it. Climb.*

Built for the signal between the trades.

</div>
