"use client";

/**
 * /docs — how The Pit works: pits on Panta markets and crypto, the room
 * book, the Oracle read, hosting and streaming, money flow, escrow, and the
 * API. Every statement here should match the code.
 */

import { useEffect, useState } from "react";
import { useEscrowStatus, useXNotices } from "@/lib/use-wallet";
import SiteHeader from "@/app/SiteHeader";
import GitHubLink from "@/app/GitHubLink";

const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").toLowerCase();
const PROGRAM_ID = process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID ?? "";

const SECTIONS: { id: string; title: string }[] = [
  { id: "overview", title: "Overview" },
  { id: "rules", title: "Game rules" },
  { id: "markets", title: "Pits on Panta markets" },
  { id: "book", title: "The room book" },
  { id: "oracle", title: "The Oracle read" },
  { id: "hosting", title: "Hosting & streaming" },
  { id: "predictions", title: "Predictions pits" },
  { id: "streak", title: "Streak pits" },
  { id: "money", title: "Seats, pool & payouts" },
  { id: "fees", title: "Fees" },
  { id: "escrow", title: "Non-custodial escrow" },
  { id: "recovery", title: "Cancellations & recovery" },
  { id: "calls", title: "Crypto pits & the price oracle" },
  { id: "trading", title: "Trading in a pit" },
  { id: "panta", title: "Panta integration" },
  { id: "usernames", title: "Signing in with X" },
  { id: "wallet", title: "Your wallet & signing" },
  { id: "api", title: "API reference" },
  { id: "trust", title: "Trust model" },
  { id: "faq", title: "FAQ" }
];

export default function DocsPage() {
  const escrow = useEscrowStatus();
  const [toast, setToast] = useState("");
  useXNotices(setToast);

  useEffect(() => {
    document.body.classList.add("game-mode");
    return () => { document.body.classList.remove("game-mode"); };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 5000);
    return () => window.clearTimeout(id);
  }, [toast]);

  return (
    <main className="game-main">
      <div className="game-grid-bg" aria-hidden="true" />
      <div className="game-scanlines" aria-hidden="true" />

      <SiteHeader
        active="docs"
        escrow={escrow}
        onToast={setToast}
      />

      <section className="page-hero">
        <p className="jt-eyebrow">Documentation</p>
        <h1><span className="hl-a">How</span> The Pit <span className="hl-b">works</span></h1>
        <p className="page-lead">
          The rules of a pit, how the room trades its own odds on a Panta market, where your USDC
          goes and how the escrow protects it. Written for players, hosts, streamers and integrators.
        </p>
      </section>

      <div className="docs-shell">
        <nav className="docs-toc" aria-label="Contents">
          <div className="toc-head">Contents</div>
          <ul>
            {SECTIONS.map((s) => (
              <li key={s.id}><a href={`#${s.id}`}>{s.title}</a></li>
            ))}
          </ul>
        </nav>

        <article className="docs-article">
          <Section id="overview" title="Overview">
            <p>
              <b>The Pit</b> turns any prediction market into a trading game on Solana. A host opens a
              <b> pit</b> on a market — tonight&apos;s game, an election, a launch, or BTC, ETH and SOL — and
              everyone who joins pays the same seat. Inside the pit the room trades <b>its own odds</b>:
              every buy and sell moves the price for everyone, starting from Panta&apos;s line. Players are
              ranked by vault value; a single round pays the pool to the top finishers, and a royale cuts
              the bottom half each round until the finalists split it.
            </p>
            <ul>
              <li><b>Host a pit on any market</b> — pick an open Panta market, or create a new one on Panta for a game or event (see <a href="#markets">Pits on Panta markets</a>).</li>
              <li><b>The pit is the terminal</b> — a live price tape, where the room&apos;s money sits, and Panta&apos;s line for reference.</li>
              <li><b>The Oracle read</b> — a running read of the pit&apos;s own market data, phrased by Claude (see <a href="#oracle">The Oracle read</a>).</li>
              <li><b>Creator mode</b> — a join code, QR and a stream overlay so an audience can play along (see <a href="#hosting">Hosting &amp; streaming</a>).</li>
            </ul>
            <p>
              Two call-contest formats need no trading at all: <b>Predictions</b> (five hidden picks on BTC,
              ETH and SOL) and <b>Streak</b> (a chain of quick calls, one miss and you&apos;re out).
            </p>
            <ol>
              <li><b>Pit engine</b> — server-side rounds (enrolling → live → settling → advancing/complete) persisted in Postgres.</li>
              <li><b>USDC escrow</b> — a non-custodial Solana program holds every seat deposit until players withdraw.</li>
              <li><b>Panta</b> — the markets: their questions, Panta&apos;s price as the opening line, resolution, and market creation.</li>
              <li><b>Price oracle</b> — live BTC, ETH and SOL spot prices for crypto pits.</li>
            </ol>
            <div className="callout">
              <b>Devnet.</b> Everything runs on Solana {CLUSTER} with Circle&apos;s devnet USDC. Test tokens have no monetary value.
            </div>
          </Section>

          <Section id="rules" title="Game rules">
            <table className="docs-table">
              <thead><tr><th>Format</th><th>Rounds</th><th>How it ends</th></tr></thead>
              <tbody>
                <tr><td><b>Single</b></td><td>1</td><td>One trading window. Players are ranked by final vault value and the pool is paid out.</td></tr>
                <tr><td><b>Royale</b></td><td>2–4</td><td>After each round the bottom half is eliminated. Survivors carry their vault into the next round until one player remains or the round limit is reached. On a Panta market every round trades the same market.</td></tr>
                <tr><td><b>Predictions</b></td><td>1</td><td>Crypto only. No trading. Every player answers the same five questions before the start; at the close each right answer is a point and the top scores are paid. See <a href="#predictions">Predictions pits</a>.</td></tr>
                <tr><td><b>Streak</b></td><td>Up to 6 legs</td><td>Crypto only. No trading. One quick call per leg; a wrong pick knocks you out. Last caller standing takes the pool. See <a href="#streak">Streak pits</a>.</td></tr>
              </tbody>
            </table>
            <div className="lifecycle-strip">
              {["Enrolling", "Live", "Settling", "Advancing / Complete"].map((s, i) => (
                <div key={s} className="ls-step">
                  <span className="ls-num">{String(i + 1).padStart(2, "0")}</span>
                  <span className="ls-lab">{s}</span>
                </div>
              ))}
            </div>
            <ul>
              <li><b>Enrolling</b> — seats are open. The clock starts once the host&apos;s own seat is confirmed: <em>Quick</em> pits stay open for 2 minutes, <em>Scheduled</em> pits for the chosen window (5 minutes to 3 hours). Enrollment locks early when every seat is filled. A host who ends up alone gets one practice opponent so the round can run.</li>
              <li><b>Live</b> — opening calls fill (at Panta&apos;s line on a Panta market, at 50¢ on a crypto pit), then everyone trades with the same starting vault. The pit shows in real time who is in the money (single round) or above and below the cut (royale). The round lasts its trading window: 5 minutes, 15 minutes or an hour.</li>
              <li><b>Settling</b> — on a Panta market, YES settles at the room&apos;s average price over the closing window, or at $1/$0 if Panta has resolved the market (see <a href="#book">The room book</a>). On a crypto pit the close is compared with the open: UP pays $1 if it closed higher, DOWN if lower (50¢ each if exactly flat). Players are ranked by vault value; ties go to whoever joined first.</li>
              <li><b>Cut</b> (royale) — the top <code>ceil(alive / 2)</code> players survive. Everyone else is eliminated and their vault is frozen at its final value until the end, when all players are paid out together.</li>
              <li><b>Complete</b> — the pit settles on-chain and every player can withdraw.</li>
            </ul>
          </Section>

          <Section id="markets" title="Pits on Panta markets">
            <p>
              When hosting, choose the market the pit trades: <b>Crypto</b> (BTC, ETH or SOL up or down),
              a <b>Panta market</b> already open on Panta, or a <b>New market</b> you create on Panta for
              the pit. Panta pits play as a single round or a royale.
            </p>
            <ul>
              <li><b>Existing markets</b> — the host list shows Panta&apos;s open, unresolved markets, busiest first, with Panta&apos;s current YES price and when each closes.</li>
              <li><b>Creating a market</b> — write a yes/no question (10–200 characters, ending in &ldquo;?&rdquo;), pick a category, a resolution rule (20–2,048 characters) and one to five sources of truth, and when it ends. Mark it <em>happening now</em> for an event already under way (a game in progress) so it opens immediately; otherwise Panta opens it about an hour after creation.</li>
              <li><b>The fee is shown first</b> — the first press asks Panta for a quote and shows the creation fee and starting liquidity; nothing is signed until you press again. Your wallet then signs Panta&apos;s create transaction and the market is registered on Panta. Only the wallet that created a market can host a pit on it through this flow.</li>
              <li><b>Opening line</b> — when enrollment locks, Panta&apos;s YES price becomes the pit&apos;s opening line. Every seat call (YES or NO) fills at that line.</li>
              <li><b>Resolution</b> — if Panta resolves the market while the pit is running, the pit settles on the real outcome ($1 for the winning side) and a royale ends there.</li>
            </ul>
            <div className="callout">
              <b>Sandbox.</b> A deployment on Panta&apos;s sandbox key has one test market, and its market-creation
              quotes show a fee but build an empty transaction, so nothing is charged. With a live key every
              open Panta market is listed and the creation fee is charged on-chain.
            </div>
          </Section>

          <Section id="book" title="The room book">
            <p>
              On a Panta market the pit doesn&apos;t copy Panta&apos;s price — the room makes its own. The pit
              runs an automated market maker (a logarithmic market scoring rule) seeded at Panta&apos;s line.
              Buying YES pushes the room&apos;s YES price up for everyone; selling or buying NO pushes it down.
            </p>
            <pre className="code">{`YES price  = 1 / (1 + e^((NO shares − YES shares) / b))
b (depth)  = total of all vaults, between 20 and 5,000
opening    = every seat call fills at Panta's line,
             then the book takes on the room's net position`}</pre>
            <ul>
              <li><b>Depth</b> — a bigger room makes a deeper book, so the same trade moves the price less.</li>
              <li><b>Your ticket</b> — before you trade, the panel shows your average fill, the shares you get and where the room&apos;s price will be after your trade.</li>
              <li><b>Practice traders</b> — when a pit has practice bots, they trade against the book and lean back toward Panta&apos;s line.</li>
              <li><b>Settlement on the average</b> — YES settles at the room&apos;s time-weighted average price over the closing window (the last 20% of the round, between 30 seconds and 10 minutes), shaded on the chart. A last-second trade can&apos;t mark the close.</li>
              <li><b>Royale</b> — each new round re-opens the book at the previous round&apos;s settlement price.</li>
            </ul>
          </Section>

          <Section id="oracle" title="The Oracle read">
            <p>
              Every trading pit shows a running read of its own market: a headline, a lean (YES, NO or
              neutral), a confidence and the signals behind it — the room against Panta&apos;s line, the
              one-minute move, where the room&apos;s money sits and the time to the bell.
            </p>
            <ul>
              <li><b>Data first</b> — the lean and confidence are computed from the pit&apos;s data. When the server has an Anthropic API key, Claude writes the headline from those numbers while the round is live; otherwise a plain read from the data is shown. The badge says which.</li>
              <li><b>Shared</b> — one read per pit, refreshed about every 20 seconds and shared by every viewer.</li>
              <li><b>No leaks</b> — while seats are open the read never uses seat calls, which stay hidden until the lock.</li>
              <li><b>Not advice</b> — it describes the pit&apos;s own numbers and never tells anyone what to buy.</li>
            </ul>
          </Section>

          <Section id="hosting" title="Hosting & streaming">
            <p>
              Host from the <b>Host</b> tab, signed in with X. The host sets the market, format, seat, capacity,
              timing and an optional host fee, then pays seat #1 like everyone else — every pit gets a fresh
              code. Creating a new market is two presses: the first checks it with Panta and shows the
              creation fee; the second creates it and opens the pit. Once created, the market is locked in
              the form, so if opening the pit fails you can retry without paying again. While the pit is open
              the host&apos;s page shows a creator kit:
            </p>
            <ul>
              <li><b>Join code and QR</b> — large enough to put on stream; scanning it opens the pit.</li>
              <li><b>Invite link</b> — <code>/a/CODE</code>, ready to post.</li>
              <li><b>Stream overlay</b> — <code>/a/CODE/overlay</code> as a Browser Source in OBS or Streamlabs (1280×720). It shows the market, the live odds and tape, Panta&apos;s line, the top of the pit, the pool and the clock, and the QR while seats are open. The background is transparent; add <code>?bg=solid</code> for a solid one. It reads only public pit state.</li>
            </ul>
          </Section>

          <Section id="predictions" title="Predictions pits">
            <p>
              A call contest with nothing to trade. Before the round starts, every player answers the same
              five questions about how the three coins move over it:
            </p>
            <table className="docs-table">
              <thead><tr><th>#</th><th>Question</th><th>Right answer</th></tr></thead>
              <tbody>
                <tr><td>1–3</td><td>BTC, ETH, SOL: up or down?</td><td>Up if the coin closes above its price at the lock, down if below.</td></tr>
                <tr><td>4</td><td>Which does best?</td><td>The coin with the biggest % change — the biggest gain, or the smallest drop if all three fall.</td></tr>
                <tr><td>5</td><td>A head-to-head, e.g. SOL or ETH</td><td>Whichever of the two has the better % change. The pair varies by pit.</td></tr>
              </tbody>
            </table>
            <ul>
              <li><b>Why relative questions</b> — BTC, ETH and SOL usually move together, so the three up/down calls often land or miss as one. &ldquo;Which does best&rdquo; and the head-to-head reward reading the market rather than calling everything the same way, and make ties much rarer.</li>
              <li><b>Hidden picks</b> — nobody else can see your picks while enrollment is open (the server shows other players only how many questions they have answered, and the deposit memo never contains picks). You can change them until the round locks; then everyone&apos;s picks are revealed.</li>
              <li><b>Judged on the lock price</b> — when enrollment locks, the live BTC, ETH and SOL prices are recorded. At the close (the timeframe: 5 minutes, 15 minutes or an hour) each coin is compared with its own opening price. While the round runs, the pit shows which answers are winning and everyone&apos;s live score.</li>
              <li><b>Scoring</b> — one point per right answer. A question with an exact dead heat (or a missing price) scores for nobody. An unanswered question scores nothing.</li>
              <li><b>Lock</b> — optionally lock 2 or 3 of your picks together, a parlay inside your card. If every locked pick is right, the lock lands and adds a bonus point per locked pick (they count double). If any locked pick is wrong, every locked pick scores 0. A locked question that ends level drops out and the rest decide the lock. Locks are hidden with your picks until the start. Because the coins usually move together, a lock on same-direction calls lands more often — and when the market turns, it all goes at once.</li>
              <li><b>Prizes</b> — the usual split of the pool: winner takes all in a duel, otherwise 62.5% / 23.44% / 14.06%. Players who tie share the places they cover equally — two players tied for first split first and second place.</li>
              <li><b>Seat</b> — just the entry. The escrow program needs a vault per seat, so a predictions seat carries a 1-unit vault (0.000001 USDC) that is returned at settlement.</li>
              <li><b>Practice</b> — the free walk-in pit at <a href="/a/PICKS">/a/PICKS</a> runs predictions rounds against bots.</li>
            </ul>
          </Section>

          <Section id="streak" title="Streak pits">
            <p>
              A parlay across time. The game is a chain of short legs, each asking one question about BTC,
              ETH or SOL — a coin up or down, a head-to-head, or which of the three does best.
            </p>
            <ul>
              <li><b>Pick window</b> — each leg opens with a 20-second window. Picks are hidden until it closes (players see only who has picked). Leg 1 can be picked as soon as you take a seat.</li>
              <li><b>The leg</b> — when the window closes the leg starts at the live price of the coins it asks about and runs for the host&apos;s leg length: 1, 2 or 5 minutes. Everyone&apos;s picks are shown while it runs.</li>
              <li><b>Out</b> — a wrong pick, or no pick, knocks you out. If every player still in misses, or the leg ends dead level, nobody goes out.</li>
              <li><b>The end</b> — the game ends when one player is left, when no real player is left, or after 6 legs. Players are ranked by how many legs they survived.</li>
              <li><b>Prizes</b> — the usual split of the pool (winner takes all in a duel; otherwise 62.5% / 23.44% / 14.06%), ties sharing their places. The seat is just the entry, like Predictions.</li>
              <li><b>Strategy</b> — moves over a minute or two are close to a coin flip, so the edge is reading the room: if most players will call UP, DOWN is how you become the last one standing.</li>
              <li><b>Practice</b> — the free walk-in pit at <a href="/a/STREAK">/a/STREAK</a> plays against a table of bots.</li>
            </ul>
          </Section>

          <Section id="money" title="Seats, pool & payouts">
            <pre className="code">{`seat      = entry + vault          (both deposited into escrow)
pool      = entry × players who paid
vault pot = vault × players who paid
withdraw  = prize share + vault pot × (your final vault ÷ all final vaults)
            (prizes come from the pool after any host fee; 0.1% platform fee on withdrawal)`}</pre>
            <table className="docs-table">
              <thead><tr><th>Players</th><th>Prize split</th></tr></thead>
              <tbody>
                <tr><td>2 (a duel)</td><td>Winner takes 100% of the pool</td></tr>
                <tr><td>3 or more</td><td>1st 62.5% · 2nd 23.44% · 3rd 14.06%</td></tr>
              </tbody>
            </table>
            <p>
              The <b>entry</b> is what you put at risk for the prize. The <b>vault</b> is your trading
              bankroll: it rises and falls with your trades, and at the end the players&apos; vault money is
              shared out in proportion to how each vault finished — one player&apos;s trading losses pay for
              another&apos;s gains. The escrow is always paid out in full: nothing is capped away and nothing
              stays locked. If every vault ends at $0, the vault money goes back equally.
            </p>
            <p>
              Example: two players each deposit $6 ($1 entry + $5 vault). A calls UP, B calls DOWN, SOL closes
              higher: A&apos;s vault finishes at $10, B&apos;s at $0, so A withdraws $10 + the $2 pool = $12 and B
              withdraws $0. Playing alone against practice bots, your vault money simply comes back — there&apos;s
              no one to win it from. The Pit takes only a 0.1% fee on withdrawals (see <a href="#fees">Fees</a>).
            </p>
          </Section>

          <Section id="fees" title="Fees">
            <table className="docs-table">
              <thead><tr><th>Fee</th><th>Who sets it</th><th>How it works</th></tr></thead>
              <tbody>
                <tr><td><b>Host fee</b> · 0–5%</td><td>The pit&apos;s host</td><td>A share of the prize pool (the entries), paid into the host&apos;s own seat at settlement. It comes off the pool before the prize split, and players see it before they join. Cancelled pits pay no host fee.</td></tr>
                <tr><td><b>Platform fee</b> · 0.1%</td><td>The Pit</td><td>Taken by the escrow program from each withdrawal of a settled pit&apos;s payout. Refunds of a cancelled pit and on-chain recoveries are free.</td></tr>
                <tr><td><b>Market creation</b></td><td>Panta</td><td>Charged by Panta, not The Pit, when you create a new market. The amount comes from Panta&apos;s quote and is shown before you sign.</td></tr>
              </tbody>
            </table>
            <pre className="code">{`host fee  = pool × host fee %
prizes    = split of (pool − host fee)
withdraw  = payout − 0.1% platform fee`}</pre>
            <p>
              The platform fee is fixed in each pit&apos;s escrow vault when it is created and capped by the
              program at 1%, so it can&apos;t be raised on a pit that already exists. Pits created before
              fees were introduced withdraw with no fee.
            </p>
          </Section>

          <Section id="escrow" title="Non-custodial escrow">
            <p>
              Each pit gets its own vault account in the escrow program
              {PROGRAM_ID && <> (<code>{PROGRAM_ID.slice(0, 4)}…{PROGRAM_ID.slice(-4)}</code>)</>}. Funds
              only leave it through three instructions, all signed by the player:
            </p>
            <ol>
              <li><b>Deposit</b> — you sign a transfer of your seat (entry + vault) into the pit vault.</li>
              <li><b>Claim</b> — after settlement you sign to withdraw your payout (prize plus your share of the vault money).</li>
              <li><b>Recover</b> — if the round is never settled, you sign to take your full seat back after the deadline.</li>
            </ol>
            <p>
              The server&apos;s operator key opens pit vaults and records each player&apos;s final
              entitlement. It cannot transfer anyone&apos;s USDC, and total entitlements can never exceed
              what was deposited.
            </p>
            <div className="callout warn">
              <b>Practice mode.</b> When on-chain escrow isn&apos;t configured the header shows
              <b> Practice</b>: pits, ranking and trading work (you still sign in with X), but no USDC
              moves and nothing is signed.
            </div>
          </Section>

          <Section id="recovery" title="Cancellations & recovery">
            <ul>
              <li><b>Host doesn&apos;t fund seat #1</b> — the host picks a side (YES/NO or UP/DOWN) or decide later and pays seat 1 like everyone else. If the host rejects the deposit, or no seat is confirmed within 3 minutes of opening, the pit closes before anyone else can join.</li>
              <li><b>Your seat follows your deposit</b> — the escrow vault is the source of truth. If your deposit confirms but the page loses its connection before the seat is registered, the pit seats you from your on-chain entry automatically (before it locks, with the username and call you chose). A pit that has received a deposit can&apos;t be cancelled as empty.</li>
              <li><b>Full refunds</b> — when a pit closes without starting, every wallet that deposited (including a deposit that confirmed after the close) is refunded its full seat. The refund opens about two minutes after the close; claim it from the pit page. A deposit that lands after the round has already started is refunded in full at settlement.</li>
              <li><b>Settlement never happens</b> — as a last resort, once the pit's recovery deadline passes (an hour after the longest the game could possibly run) any depositor can call Recover on the escrow program and receive their full seat. Your Positions page shows a Recover button when that applies.</li>
            </ul>
          </Section>

          <Section id="calls" title="Crypto pits & the price oracle">
            <p>
              A crypto pit asks one question — for example <em>&ldquo;Will Solana be up in 5 minutes?&rdquo;</em>
              <b> UP</b> (a YES share) pays $1 if the asset closes the round above its opening price;
              <b> DOWN</b> (a NO share) pays $1 if it closes below. A dead-flat close pays 50¢ each way.
            </p>
            <ul>
              <li><b>Opening call</b> — when you take a seat you pick UP, DOWN or <em>decide later</em>. A call puts a quarter, half (the default) or all of your vault on that side at the opening price (50¢ a share) the moment trading opens; the rest stays in cash for your trades. You can change it until then, and switch or sell any time while the round is live — switching sides sells your current position and buys the other side in one step. Other players can&apos;t see your call until the round starts.</li>
              <li><b>Open</b> — the asset&apos;s spot price when enrollment locks. BTC, ETH and SOL are all recorded (a Predictions pit is judged on all three).</li>
              <li><b>Live price</b> — the UP price is the chance the asset finishes above the open, given the move so far and the time left, so positions gain or lose value as the asset moves.</li>
              <li><b>Close</b> — the price sample nearest the deadline (the pit is polled every few seconds while anyone watches; otherwise the one-minute candle at the deadline).</li>
              <li><b>Source</b> — Coinbase&apos;s public spot price, with Kraken as backup. If no price is available the lock or the settlement waits up to a minute; a round that still can&apos;t be priced settles at 50¢ both ways.</li>
            </ul>
          </Section>

          <Section id="trading" title="Trading in a pit">
            <p>
              Buying a side (YES/NO, or UP/DOWN on a crypto pit) moves USDC from your vault into shares;
              selling closes the position. Your vault value — cash plus marked positions — decides your
              rank and is what the cut line compares. On a Panta market every trade fills against the
              room book (see <a href="#book">The room book</a>) and is marked at the room&apos;s price; the
              last-call and price-moved rules below apply there too.
            </p>
            <p>On a crypto pit every player trades on the same live prices, and three rules keep it fair:</p>
            <ul>
              <li><b>1¢ spread</b> — you buy 1¢ above and sell 1¢ below the market price. Changing your mind
                is allowed any time, but flipping back and forth costs something, so re-trading every small
                lag in the price doesn&apos;t pay. Opening calls and settlement don&apos;t pay the spread.</li>
              <li><b>Last call</b> — trading closes 30 seconds before the deadline, so
                nobody can pile onto a near-certain outcome in the final seconds.</li>
              <li><b>Live quotes</b> — each trade is priced on BTC/ETH/SOL quotes taken at that moment from
                Coinbase and Kraken. While the asset is jumping, or the two exchanges disagree, trading pauses
                for a few seconds until the price settles. If the price moved more than 5¢ from the one you
                were shown, the trade isn&apos;t filled and you see the new price instead.</li>
            </ul>
            <p>
              On a crypto pit that runs on a real Panta market you can switch on <b>Also fill on Panta</b>.
              The same order is then placed on Panta&apos;s primary book from your wallet, in six steps
              shown live in the trade panel:
            </p>
            <ol className="lifecycle-list">
              <li><b>Quote</b> — price, expected shares and fee from <code>/primaryorderquote/</code>.</li>
              <li><b>Build</b> — Panta returns raw Solana instructions and a blockhash from <code>/primaryorderbuild/</code>.</li>
              <li><b>Sign</b> — your wallet signs a v0 transaction compiled in the browser, with you as fee payer.</li>
              <li><b>Submit</b> — the signature is registered with <code>/primaryordersubmit/</code>.</li>
              <li><b>Verify</b> — <code>/primaryorderverify/</code> is polled until confirmed, failed or expired.</li>
              <li><b>Attribute</b> — <code>/trades/{`{signature}`}/</code> confirms the trade was credited.</li>
            </ol>
          </Section>

          <Section id="panta" title="Panta integration">
            <p>
              All Panta calls are made server-side through The Pit&apos;s <code>/api/*</code> routes;
              the API key never reaches the browser. Requests carry The Pit&apos;s <code>X-User-Id</code>
              so trades and created markets are attributed.
            </p>
            <table className="docs-table">
              <thead><tr><th>Panta endpoint</th><th>Used for</th></tr></thead>
              <tbody>
                <tr><td><code>GET /markets/…</code></td><td>Open markets for hosting, Panta&apos;s line, and resolution</td></tr>
                <tr><td><code>POST /markets/create/{`{quote,build}`}/</code> · <code>/markets/register/</code></td><td>Creating a market for a pit</td></tr>
                <tr><td><code>GET /positions/</code></td><td>Your pits, positions and withdrawals</td></tr>
                <tr><td><code>POST /primaryorder{`{quote,build,submit,verify}`}/</code></td><td>Mirrored orders</td></tr>
                <tr><td><code>POST /claim/build/</code></td><td>Claiming a winning Panta position</td></tr>
                <tr><td><code>GET /trades/{`{signature}`}/</code></td><td>Attribution check</td></tr>
              </tbody>
            </table>
          </Section>

          <Section id="usernames" title="Signing in with X">
            <p>
              The Pit is played with an <b>X (Twitter) account</b> — there is no other way to sign in. Press
              <b> Sign in with X</b>, approve on X, and you come straight back signed in. Your X handle is your
              username on the pit stage, standings, activity feed and results; it is set the first time you sign
              in, and an X account is one player, so nobody can play under someone else&apos;s name.
            </p>
            <ul>
              <li><b>Your Solana wallet</b> — signing in creates a Solana wallet for your X account (a Privy embedded wallet). It is yours: it holds your USDC, pays your seats and receives your payouts.</li>
              <li><b>See it any time</b> — open your account (your handle, top right) for the full address with copy, QR and explorer links, its USDC and SOL balances, and where to get {CLUSTER} test tokens.</li>
              <li><b>Export the key</b> — <em>Export private key</em> in the account menu opens Privy&apos;s own window to copy the wallet&apos;s key into another wallet app. The key is shown on Privy&apos;s domain; The Pit never sees it.</li>
              <li><b>Sessions</b> — signing in keeps you signed in on this browser for up to a week; <em>Sign out</em> ends it.</li>
            </ul>
          </Section>

          <Section id="wallet" title="Your wallet & signing">
            <ul>
              <li><b>Fund it</b> — send {CLUSTER} USDC (from faucet.circle.com, choose Solana Devnet) and a little SOL for network fees (faucet.solana.com) to the address in your account menu.</li>
              <li><b>Approving</b> — a seat deposit, a withdrawal or a market creation opens a confirmation from your X wallet; nothing moves until you approve it.</li>
              <li><b>Escrow deposit, claim and recover</b> are transactions built by the server, checked with a dry run on Solana {CLUSTER} before you see them, and signed by your X wallet. The app sends each one to {CLUSTER} itself. Approve within about a minute; an older transaction expires and nothing is taken. The deposit carries a memo with the pit, the seat amount and the game type, visible on the explorer. It never includes your opening call or picks, since those stay hidden until the round starts.</li>
              <li><b>Panta orders and claims</b> are v0 transactions compiled in your browser from Panta&apos;s instructions.</li>
              <li>Your X wallet pays the network fee for every transaction it signs.</li>
            </ul>
            <p>
              Before any deposit the server checks your X wallet holds enough USDC for the seat (plus Panta&apos;s
              fee when you create a market) and about 0.005 SOL for fees, so you&apos;re never asked to approve a
              transaction that would fail.
            </p>
          </Section>

          <Section id="api" title="API reference">
            <table className="docs-table">
              <thead><tr><th>Route</th><th>Purpose</th></tr></thead>
              <tbody>
                <tr><td><code>GET /api/arenas</code></td><td>Open pits (enrolling, live, settling, advancing)</td></tr>
                <tr><td><code>GET /api/round?arena=</code></td><td>Round state, standings, cut line, YES price, Panta line, price tape and live spot price for one pit</td></tr>
                <tr><td><code>POST /api/round</code></td><td>Open a new pit (creates its on-chain vault); <code>marketSource: &quot;panta&quot;</code> with a <code>pantaMarketId</code> or your <code>draftId</code></td></tr>
                <tr><td><code>GET /api/round/read?arena=</code></td><td>The Oracle read for a trading pit</td></tr>
                <tr><td><code>GET /api/markets/catalog</code></td><td>Open Panta markets a pit can be hosted on</td></tr>
                <tr><td><code>POST /api/markets/{`{quote,build,register}`}</code></td><td>Create a Panta market (signed in; the quote returns the fee and a draft id)</td></tr>
                <tr><td><code>POST /api/auth/x</code></td><td>Sign in: Privy&apos;s proof of the X account and its wallet → session cookie</td></tr>
                <tr><td><code>GET /api/auth/session</code></td><td>Who this browser is signed in as (wallet and X handle)</td></tr>
                <tr><td><code>POST /api/round/enroll</code></td><td>Take a seat (signed in); returns <code>needsDeposit</code> until your on-chain deposit exists, <code>pending</code> while it confirms</td></tr>
                <tr><td><code>POST /api/round/call</code></td><td>Change your opening UP/DOWN call while enrolling</td></tr>
                <tr><td><code>POST /api/round/picks</code></td><td>Predictions: change picks or your lock while enrolling. Streak: pick the open leg (signed in)</td></tr>
                <tr><td><code>POST /api/round/cancel</code></td><td>Cancel a pit whose host never funded seat #1</td></tr>
                <tr><td><code>POST /api/round/trade</code></td><td>Buy a side or sell inside the pit (signed in)</td></tr>
                <tr><td><code>GET /api/escrow/status</code></td><td>On-chain or practice mode</td></tr>
                <tr><td><code>GET /api/escrow/balance?wallet=</code></td><td>Devnet USDC and SOL for a wallet</td></tr>
                <tr><td><code>POST /api/escrow/tx</code></td><td>Unsigned deposit, claim or recover transaction</td></tr>
                <tr><td><code>POST /api/escrow/settle</code></td><td>Record final entitlements on-chain (idempotent)</td></tr>
                <tr><td><code>POST /api/orders/{`{quote,build,submit,verify}`}</code></td><td>Panta order proxies</td></tr>
                <tr><td><code>GET /api/portfolio?wallet=</code></td><td>A wallet&apos;s pits: live positions, standings, and payouts or refunds to withdraw (game ledger + on-chain deposits)</td></tr>
                <tr><td><code>GET /api/positions?wallet=</code></td><td>Panta positions for a wallet</td></tr>
              </tbody>
            </table>
          </Section>

          <Section id="trust" title="Trust model">
            <table className="docs-table">
              <thead><tr><th>You rely on</th><th>For</th><th>If it fails</th></tr></thead>
              <tbody>
                <tr><td>Escrow program</td><td>Holding deposits</td><td>Funds only move with your signature</td></tr>
                <tr><td>The Pit server</td><td>Running rounds, the room book and recording results</td><td>Recover returns your full seat after the deadline</td></tr>
                <tr><td>Price oracle (Coinbase, Kraken)</td><td>Crypto pits: opening and closing prices</td><td>The round waits up to a minute, then settles at 50¢ both ways</td></tr>
                <tr><td>Panta</td><td>Markets, the opening line, resolution, mirrored orders</td><td>A pit already trading keeps its room book and settles on its own average</td></tr>
                <tr><td>Claude (optional)</td><td>Phrasing the Oracle read</td><td>The read falls back to the plain data read</td></tr>
                <tr><td>Your X wallet (Privy)</td><td>Every signature</td><td>Nothing moves without your approval; export the key to use the wallet elsewhere</td></tr>
                <tr><td>X and Privy</td><td>Signing in</td><td>You can&apos;t sign in until they&apos;re back; deposits stay in escrow and recovery still works with the exported key</td></tr>
              </tbody>
            </table>
          </Section>

          <Section id="faq" title="FAQ">
            <div className="faq">
              <details open>
                <summary>Where do I get test funds?</summary>
                <p>Devnet USDC from faucet.circle.com (choose Solana Devnet) and devnet SOL for fees from faucet.solana.com.</p>
              </details>
              <details>
                <summary>Why doesn&apos;t the pit&apos;s price match Panta&apos;s?</summary>
                <p>It starts at Panta&apos;s line and then moves with the room&apos;s own trades. The gap between the two is part of the game — the stage and chart always show both.</p>
              </details>
              <details>
                <summary>Can the host take my deposit?</summary>
                <p>No. The host only chooses the settings. Deposits sit in the escrow program and only your signature can withdraw them.</p>
              </details>
              <details>
                <summary>Do I have to pick a side when I sit down?</summary>
                <p>No — choose <em>decide later</em> and trade once the round is live. If you do pick, the share of your vault you choose (a quarter, half or all of it) goes on that side at the opening price, and you can still switch or sell during the round. Predictions pits have no call: you answer five questions instead.</p>
              </details>
              <details>
                <summary>In a Predictions pit, can anyone see my picks before the start?</summary>
                <p>No. Until the round locks, other players only see how many of the five questions you have answered. Your picks aren&apos;t in the public deposit transaction either. Once the round starts, every player&apos;s picks are shown.</p>
              </details>
              <details>
                <summary>In a Streak, what if I miss a pick window?</summary>
                <p>No pick counts as a wrong pick, so you&apos;re out — unless every other player still in misses that leg too, or it ends level. Keep the pit open while you play; each window is 20 seconds.</p>
              </details>
              <details>
                <summary>What if I close the tab mid-round?</summary>
                <p>Your position stays open and is closed at the final price like everyone else&apos;s. Come back after the round to withdraw.</p>
              </details>
              <details>
                <summary>Why not trade on Panta directly?</summary>
                <p>You can. The Pit adds the game: equal seats, a shared pool, a room that trades its own odds, live rankings and eliminations.</p>
              </details>
              <details>
                <summary>Is The Pit part of Panta?</summary>
                <p>No. It is an independent product built on the Panta Public API for the Panta API Sidetrack of the Colosseum hackathon.</p>
              </details>
            </div>
          </Section>

          <footer className="docs-foot">
            <div>The Pit · Solana {CLUSTER} · Built on Panta</div>
            <div className="docs-foot-links"><GitHubLink /></div>
          </footer>
        </article>
      </div>

      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button onClick={() => setToast("")} aria-label="Dismiss">×</button>
        </div>
      )}
    </main>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="doc-sec" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{title}<a href={`#${id}`} aria-label={`Link to ${title}`}>#</a></h2>
      {children}
    </section>
  );
}
