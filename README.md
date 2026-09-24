# Oracle Rumble

> **A game lobby for prediction markets.**
> Pick a ring, stake your conviction on live Panta markets, stack legs into a parlay, carve your name into the hall of champions.

Oracle Rumble is a Solana-native prediction-market arena that treats forecasting like a game. Players enter **rings** — themed rumbles curated around an event, a thesis, or a community — take YES/NO positions from their wallet, and climb a public leaderboard. The market layer is [Panta](https://docs.panta.market/); the parlay engine, ring system, and game-lobby UI are the experience layer.

**Status:** hackathon prototype. The demo runs end-to-end in the browser with mock market ticks; adding `PANTA_API_KEY` to `.env.local` flips every server route to the real Panta API with zero client-side changes.

## What's inside

- **Rings** — three seeded arenas (Solana Signals · Mage / Fight Night · Warrior / Shipmas · Architect) with themed sigils, class labels, and a bracketed HUD lobby aesthetic.
- **Live market board** — category chips, live-ticking prices, countdown per ring, parlay slip.
- **Native parlays** — the mechanics are borrowed from [parlayit.gg](https://docs.parlayit.gg/):
  - 2 ≤ legs ≤ 5
  - Correlation blocks — legs sharing a `correlationGroup` (e.g. KO vs Decision) are mutually exclusive
  - Variance-based per-leg fee: `stake × 5% × 4p(1-p)`, aggregate capped at 5% of stake
  - 50/50 fallback — a voided leg pays 0.5×, so the parlay's payout is halved once per voided leg
  - Quote-based liquidity — `POST /api/parlay/quote` refreshes leg prices live from Panta and re-prices the parlay dynamically
- **Full Panta lifecycle** — every trade runs `quote → build → sign → submit → report` end-to-end.
- **Wallet** — detects Phantom / Backpack / Solflare via `window.solana`; falls back to a demo wallet (random base58 pubkey) if none present. Positions and parlays persist to `localStorage`.

## Panta API surface

Every one of these routes maps 1:1 to a Panta endpoint documented at [docs.panta.market/llms.txt](https://docs.panta.market/llms.txt). The API key never touches the browser — every server route reads it from `PANTA_API_KEY` and injects `X-Api-Key` before proxying. Missing key ⇒ mock fallback.

### Market catalog

| Our route | Panta endpoint |
| --- | --- |
| `GET /api/markets` | `GET /markets` |
| `GET /api/markets/[id]` | `GET /markets/{id}` |
| `GET /api/markets/[id]/trades` | `GET /markets/{id}/trades` |
| `GET /api/categories` | `GET /markets/categories` |

### Trading lifecycle

| Our route | Panta endpoint |
| --- | --- |
| `POST /api/orders/quote` | `POST /orders/quote` |
| `POST /api/orders/build` | `POST /orders/build` |
| `POST /api/orders/submit` | `POST /orders/submit` |
| `POST /api/orders/verify` | `POST /orders/verify` |
| `POST /api/trades/report` | `POST /trades/report` |
| `POST /api/parlay/quote` | *(client-space parlay pricing, refreshed from `/markets/{id}` per leg)* |

### Positions & claims

| Our route | Panta endpoint |
| --- | --- |
| `GET /api/positions?wallet=` | `GET /positions?wallet=` |
| `POST /api/claims/build` | `POST /claims/build` |

### Market creation (host a rumble)

| Our route | Panta endpoint |
| --- | --- |
| `POST /api/markets/quote` | `POST /markets/quote` |
| `POST /api/markets/build` | `POST /markets/build` |
| `POST /api/markets/register` | `POST /markets/register` |

## Real Solana signing

`lib/panta-client.ts` uses [`@solana/web3.js`](https://github.com/solana-labs/solana-web3.js) to deserialize Panta's base64 `serializedTx` payload into a `VersionedTransaction`, hand it to the wallet for `signAndSendTransaction`, broadcast it via `NEXT_PUBLIC_SOLANA_RPC`, and poll for on-chain confirmation before reporting the signature back to Panta.

- Wallets detected: Phantom · Backpack · Solflare
- Fallback: mock base58 signature when no wallet is present (demo mode)
- After submit, the client also polls `/api/orders/verify` for Panta's own async confirmation pickup

## Run it

```bash
npm install
npm run dev       # http://localhost:3000
npm run build     # production build
npm run lint      # tsc --noEmit
```

## Deploy (Railway)

The repo ships with a Nixpacks plan and `railway.json` so it drops straight into Railway:

```bash
railway up
```

- [`nixpacks.toml`](nixpacks.toml) pins Node 20 and runs `npm ci` → `npm run build` → `npm run start`.
- [`railway.json`](railway.json) sets the healthcheck (`/`), a 100s startup budget, and an on-failure restart policy with 3 retries.

## Configuration

Copy [`.env.example`](.env.example) to `.env.local` and set:

- `PANTA_API_KEY` — flips every server route from mock to live Panta.
- `PANTA_API_BASE` — override for staging or self-hosted proxies (default: `https://live-api.panta.market/api/v1`).
- `PANTA_ATTRIBUTION_KEY` — partner attribution key sent with `/trades/report`.
- `NEXT_PUBLIC_SOLANA_RPC` — Solana RPC endpoint used by the client to broadcast wallet-signed transactions.

## Repo layout

```
app/
  layout.tsx               root metadata
  page.tsx                 game-lobby UI (client component)
  globals.css              theme + layout
  api/
    categories/            allowlist of Panta categories
    claims/build/          POST /claims/build proxy
    markets/               list + [id] single-market proxies
    orders/                quote / build / submit lifecycle
    parlay/quote/          dynamic parlay pricing (server-priced)
    positions/             GET /positions proxy
    trades/report/         partner attribution proxy
lib/
  arena-data.ts            demo arenas, markets, players, types
  panta.ts                 Panta server client + types
  panta-client.ts          browser helpers hitting /api/*
  parlay.ts                parlay math — variance fee, correlation, 50/50 fallback
nixpacks.toml              Railway build plan
railway.json               Railway deploy config
```
