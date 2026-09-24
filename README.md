# Oracle Rumble

> **Where hunches enter the ring.**
> Call the market, watch your edge move in real time, and climb the board.

Oracle Rumble is a social prediction-market arena built on Panta. Instead of trading in isolation, players step into **rings** — time-boxed rumbles around a shared set of live markets — take YES/NO positions from their wallet, and see a public leaderboard reward the sharpest calls.

**Status:** hackathon prototype. The demo runs end-to-end in the browser with mock market ticks; the Panta boundary is wired at `app/api/markets/route.ts` and ready to be pointed at real Panta data.

## Why this exists

Prediction markets contain a powerful signal, but participating in them is usually a lonely experience: find a market, trade it, wait for resolution. Communities, creators, and event audiences have no compelling shared loop around that signal.

Oracle Rumble makes market intelligence social:

- A creator opens a ring around a topic, event, or community thesis.
- Players discover the relevant live Panta markets and take YES/NO positions from one place.
- The ring translates positions and moving prices into an understandable live score.
- At the end of the window, the leaderboard celebrates the strongest forecasters and preserves the community's prediction history.

The result is useful before markets even resolve: it gives communities a structured way to surface conviction, discuss changing odds, and learn from the crowd.

## The product

### Core loop

1. **Pick a ring** — e.g. *Solana Signals*, *Fight Night*, *Shipmas*.
2. **Scan the board** — live Panta markets curated by the host, with prices, resolution terms, and time remaining.
3. **Trade with Panta** — buy YES or NO positions through wallet-signed transactions built by the Panta API.
4. **Track your ring** — the My Ring panel tracks your open positions and live P&L in the browser.
5. **Close it out** — once markets resolve, verify final positions, rank rumblers, and publish a shareable recap.

### What makes it different

| Traditional prediction-market UI | Oracle Rumble |
| --- | --- |
| One trader, one market | A community competing around a curated market set |
| Market discovery is the destination | Discovery is embedded inside a creator or event experience |
| Results are private to the wallet | Rankings, recaps, streaks, and social proof create a reason to return |
| Generic market list | Themed rings with clear rules, context, and time windows |

### Initial ring formats

- **Creator Ring:** creators curate markets for their audience and host a recurring forecasting league.
- **Event Ring:** a live companion for sports, crypto conferences, launches, or cultural moments.
- **Research Ring:** teams compare competing theses and use market probabilities as a decision signal.
- **Open Ring:** anyone can join a public, topic-based leaderboard.

## Panta API integration

Panta is the market layer; Oracle Rumble is the experience layer. We deliberately use Panta rather than re-implementing order books, market resolution, positions, or settlement.

| Product capability | Panta API role |
| --- | --- |
| Ring market board | Discover markets and retrieve market metadata, prices, and data |
| Trade ticket | Build user transactions for YES/NO purchases; the user signs with their wallet |
| Portfolio and scoring | Read wallet positions and calculate live ring metrics from market data |
| Ring completion | Check claim eligibility and build claim transactions for resolved positions |
| Creator workflows | Create markets where a ring needs an original, well-scoped question; retrieve creation-fee quotes and claim creator fees where applicable |
| Attribution | Verify and attribute trades to the ring so rankings only count qualifying activity |

The current build stubs this at `app/api/markets/route.ts` — swap the mock response for the Panta discovery/data calls documented at [docs.panta.market](https://docs.panta.market/) and the rest of the UI wires straight through.

## Run it

```bash
npm install
npm run dev       # http://localhost:3000
npm run build     # production build
npm run lint      # tsc --noEmit
```

## Repo layout

```
app/
  layout.tsx            root metadata
  page.tsx              full arena UI (client component)
  globals.css           theme + layout
  api/markets/route.ts  Panta boundary (mocked)
lib/
  arena-data.ts         demo arenas, markets, players, types
```
