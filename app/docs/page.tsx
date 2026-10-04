"use client";

/**
 * /docs — how Oracle Rumble works: game rules, UP/DOWN calls and the price
 * oracle, money flow, escrow, Panta integration, and the API. Every
 * statement here should match the code.
 */

import { useCallback, useEffect, useState } from "react";
import { useEscrowStatus, useWalletIdentity } from "@/lib/use-wallet";
import SiteHeader from "@/app/SiteHeader";
import UsernameModal from "@/app/UsernameModal";
import GitHubLink from "@/app/GitHubLink";

const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").toLowerCase();
const PROGRAM_ID = process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID ?? "";

const SECTIONS: { id: string; title: string }[] = [
  { id: "overview", title: "Overview" },
  { id: "rules", title: "Game rules" },
  { id: "predictions", title: "Predictions arenas" },
  { id: "money", title: "Seats, pool & payouts" },
  { id: "escrow", title: "Non-custodial escrow" },
  { id: "recovery", title: "Cancellations & recovery" },
  { id: "calls", title: "UP / DOWN & the price oracle" },
  { id: "trading", title: "Trading in an arena" },
  { id: "parlays", title: "Parlays & cash-out" },
  { id: "panta", title: "Panta integration" },
  { id: "usernames", title: "Usernames" },
  { id: "wallet", title: "Wallets & signing" },
  { id: "api", title: "API reference" },
  { id: "trust", title: "Trust model" },
  { id: "faq", title: "FAQ" }
];

export default function DocsPage() {
  const { wallet, username, toggleConnect, saveUsername } = useWalletIdentity();
  const escrow = useEscrowStatus();
  const [showUsername, setShowUsername] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    document.body.classList.add("game-mode");
    return () => { document.body.classList.remove("game-mode"); };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 5000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const connect = useCallback(async () => {
    const r = await toggleConnect();
    setToast(r.message);
    if (r.needsUsername) setShowUsername(true);
  }, [toggleConnect]);

  return (
    <main className="game-main">
      <div className="game-grid-bg" aria-hidden="true" />
      <div className="game-scanlines" aria-hidden="true" />

      <SiteHeader
        active="docs"
        wallet={wallet}
        username={username}
        escrow={escrow}
        onConnect={connect}
        onEditUsername={() => setShowUsername(true)}
      />

      <section className="page-hero">
        <p className="jt-eyebrow">Documentation</p>
        <h1><span className="hl-a">How</span> Oracle Rumble <span className="hl-b">works</span></h1>
        <p className="page-lead">
          The rules of an arena, how UP and DOWN calls are priced and resolved, where your USDC
          goes and how the escrow protects it. Written for players, hosts and integrators.
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
              <b>Oracle Rumble</b> is a prediction-market battle royale on Solana. Players pay the
              same seat and call whether BTC, ETH or SOL finishes the round <b>UP</b> or <b>DOWN</b>
              from its opening price. Everyone is ranked by vault value. A single round pays the prize
              pool to the top finishers; a royale cuts the bottom half each round until the finalists
              split the pool. A <b>Predictions</b> arena has no trading at all: five hidden picks on
              BTC, ETH and SOL, and the most right answers take the pool.
            </p>
            <ol>
              <li><b>Arena engine</b> — server-side rounds (enrolling → live → settling → advancing/complete) persisted in Postgres.</li>
              <li><b>USDC escrow</b> — a non-custodial Solana program holds every seat deposit until players withdraw.</li>
              <li><b>Price oracle</b> — live BTC, ETH and SOL spot prices open and resolve every round.</li>
              <li><b>Panta</b> — positions, and optional mirrored orders on Panta&apos;s primary book.</li>
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
                <tr><td><b>Royale</b></td><td>2–4</td><td>After each round the bottom half is eliminated. Survivors carry their vault into the next round until one player remains or the round limit is reached.</td></tr>
                <tr><td><b>Predictions</b></td><td>1</td><td>No trading. Every player answers the same five questions before the start; at the close each right answer is a point and the top scores are paid. See <a href="#predictions">Predictions arenas</a>.</td></tr>
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
              <li><b>Enrolling</b> — seats are open. The clock starts once the host&apos;s own seat is confirmed: <em>Quick</em> arenas stay open for 2 minutes, <em>Scheduled</em> arenas for the chosen window (5 minutes to 3 hours). Enrollment locks early when every seat is filled. A host who ends up alone gets one practice opponent so the round can run.</li>
              <li><b>Live</b> — the round opens at the asset&apos;s live price. Opening calls go in, then everyone trades UP/DOWN with the same starting vault. The arena shows in real time who is in the money (single round) or above and below the cut (royale). The round lasts its timeframe: 5 minutes, 15 minutes or an hour.</li>
              <li><b>Settling</b> — at the deadline the asset&apos;s close is compared with its open: UP shares pay $1 if it closed higher, DOWN shares if lower (50¢ each if exactly flat). Players are ranked by vault value; ties go to whoever joined first.</li>
              <li><b>Cut</b> (royale) — the top <code>ceil(alive / 2)</code> players survive. Everyone else is eliminated and their vault is frozen at its final value until the end, when all players are paid out together.</li>
              <li><b>Complete</b> — the arena settles on-chain and every player can withdraw.</li>
            </ul>
          </Section>

          <Section id="predictions" title="Predictions arenas">
            <p>
              A call contest with nothing to trade. Before the round starts, every player answers the same
              five questions about how the three coins move over it:
            </p>
            <table className="docs-table">
              <thead><tr><th>#</th><th>Question</th><th>Right answer</th></tr></thead>
              <tbody>
                <tr><td>1–3</td><td>BTC, ETH, SOL: up or down?</td><td>Up if the coin closes above its price at the lock, down if below.</td></tr>
                <tr><td>4</td><td>Which does best?</td><td>The coin with the biggest % change — the biggest gain, or the smallest drop if all three fall.</td></tr>
                <tr><td>5</td><td>A head-to-head, e.g. SOL or ETH</td><td>Whichever of the two has the better % change. The pair varies by arena.</td></tr>
              </tbody>
            </table>
            <ul>
              <li><b>Why relative questions</b> — BTC, ETH and SOL usually move together, so the three up/down calls often land or miss as one. &ldquo;Which does best&rdquo; and the head-to-head reward reading the market rather than calling everything the same way, and make ties much rarer.</li>
              <li><b>Hidden picks</b> — nobody else can see your picks while enrollment is open (the server shows other players only how many questions they have answered, and the deposit memo never contains picks). You can change them until the round locks; then everyone&apos;s picks are revealed.</li>
              <li><b>Judged on the lock price</b> — when enrollment locks, the live BTC, ETH and SOL prices are recorded. At the close (the timeframe: 5 minutes, 15 minutes or an hour) each coin is compared with its own opening price. While the round runs, the arena shows which answers are winning and everyone&apos;s live score.</li>
              <li><b>Scoring</b> — one point per right answer. A question with an exact dead heat (or a missing price) scores for nobody. An unanswered question scores nothing.</li>
              <li><b>Prizes</b> — the usual split of the pool: winner takes all in a duel, otherwise 62.5% / 23.44% / 14.06%. Players who tie share the places they cover equally — two players tied for first split first and second place.</li>
              <li><b>Seat</b> — just the entry. The escrow program needs a vault per seat, so a predictions seat carries a 1-unit vault (0.000001 USDC) that is returned at settlement.</li>
              <li><b>Practice</b> — the free walk-in arena at <a href="/a/PICKS">/a/PICKS</a> runs predictions rounds against bots.</li>
            </ul>
          </Section>

          <Section id="money" title="Seats, pool & payouts">
            <pre className="code">{`seat      = entry + vault          (both deposited into escrow)
pool      = entry × players who paid
vault pot = vault × players who paid
withdraw  = prize share + vault pot × (your final vault ÷ all final vaults)`}</pre>
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
              no one to win it from. Oracle Rumble takes no cut.
            </p>
          </Section>

          <Section id="escrow" title="Non-custodial escrow">
            <p>
              Each arena gets its own vault account in the escrow program
              {PROGRAM_ID && <> (<code>{PROGRAM_ID.slice(0, 4)}…{PROGRAM_ID.slice(-4)}</code>)</>}. Funds
              only leave it through three instructions, all signed by the player:
            </p>
            <ol>
              <li><b>Deposit</b> — you sign a transfer of your seat (entry + vault) into the arena vault.</li>
              <li><b>Claim</b> — after settlement you sign to withdraw your payout (prize plus your share of the vault money).</li>
              <li><b>Recover</b> — if the round is never settled, you sign to take your full seat back after the deadline.</li>
            </ol>
            <p>
              The server&apos;s operator key opens arena vaults and records each player&apos;s final
              entitlement. It cannot transfer anyone&apos;s USDC, and total entitlements can never exceed
              what was deposited.
            </p>
            <div className="callout warn">
              <b>Practice mode.</b> When on-chain escrow isn&apos;t configured the header shows
              <b> Practice</b>: arenas, ranking and trading work, but no USDC moves and no wallet
              signature is requested.
            </div>
          </Section>

          <Section id="recovery" title="Cancellations & recovery">
            <ul>
              <li><b>Host doesn&apos;t fund seat #1</b> — the host picks UP, DOWN or decide later and pays seat 1 like everyone else. If the host rejects the deposit, or no seat is confirmed within 3 minutes of opening, the arena closes before anyone else can join.</li>
              <li><b>Your seat follows your deposit</b> — the escrow vault is the source of truth. If your deposit confirms but the page loses its connection before the seat is registered, the arena seats you from your on-chain entry automatically (before it locks, with the username and call you chose). An arena that has received a deposit can&apos;t be cancelled as empty.</li>
              <li><b>Full refunds</b> — when an arena closes without starting, every wallet that deposited (including a deposit that confirmed after the close) is refunded its full seat. The refund opens about two minutes after the close; claim it from the arena page. A deposit that lands after the round has already started is refunded in full at settlement.</li>
              <li><b>Settlement never happens</b> — as a last resort, once the arena's recovery deadline passes (an hour after the longest the game could possibly run) any depositor can call Recover on the escrow program and receive their full seat. Your Positions page shows a Recover button when that applies.</li>
            </ul>
          </Section>

          <Section id="calls" title="UP / DOWN & the price oracle">
            <p>
              Every round asks one question — for example <em>&ldquo;Will Solana be up in 5 minutes?&rdquo;</em>
              <b> UP</b> (a YES share) pays $1 if the asset closes the round above its opening price;
              <b> DOWN</b> (a NO share) pays $1 if it closes below. A dead-flat close pays 50¢ each way.
            </p>
            <ul>
              <li><b>Opening call</b> — when you take a seat you pick UP, DOWN or <em>decide later</em>. A call puts a quarter, half (the default) or all of your vault on that side at the opening price (50¢ a share) the moment trading opens; the rest stays in cash for trades and parlays. You can change it until then, and switch or sell any time while the round is live — switching sides sells your current position and buys the other side in one step. Other players can&apos;t see your call until the round starts.</li>
              <li><b>Open</b> — the asset&apos;s spot price when enrollment locks. BTC, ETH and SOL are all recorded so parlay legs resolve over the same window.</li>
              <li><b>Live price</b> — the UP price is the chance the asset finishes above the open, given the move so far and the time left, so positions gain or lose value as the asset moves.</li>
              <li><b>Close</b> — the price sample nearest the deadline (the arena is polled every few seconds while anyone watches; otherwise the one-minute candle at the deadline).</li>
              <li><b>Source</b> — Coinbase&apos;s public spot price, with Kraken as backup. If no price is available the lock or the settlement waits up to a minute; a round that still can&apos;t be priced settles at 50¢ both ways.</li>
            </ul>
          </Section>

          <Section id="trading" title="Trading in an arena">
            <p>
              Buying UP or DOWN moves USDC from your vault into shares at the current price; selling
              closes the position at the live mark. Your vault value — cash plus marked positions —
              decides your rank and is what the cut line compares.
            </p>
            <p>Every player trades on the same prices, and three rules keep it fair:</p>
            <ul>
              <li><b>1¢ spread</b> — you buy 1¢ above and sell 1¢ below the market price. Changing your mind
                is allowed any time, but flipping back and forth costs something, so re-trading every small
                lag in the price doesn&apos;t pay. Opening calls and settlement don&apos;t pay the spread.</li>
              <li><b>Last call</b> — trading, parlays and cash-outs close 30 seconds before the deadline, so
                nobody can pile onto a near-certain outcome in the final seconds.</li>
              <li><b>Live quotes</b> — each trade is priced on BTC/ETH/SOL quotes taken at that moment from
                Coinbase and Kraken. While the asset is jumping, or the two exchanges disagree, trading pauses
                for a few seconds until the price settles. If the price moved more than 5¢ from the one you
                were shown, the trade isn&apos;t filled and you see the new price instead.</li>
            </ul>
            <p>
              When the arena runs on a real Panta market you can switch on <b>Also fill on Panta</b>.
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

          <Section id="parlays" title="Parlays & cash-out">
            <ul>
              <li><b>Up to 3 legs</b> — one UP/DOWN call each on BTC, ETH and SOL, paid from your vault cash. Every leg resolves on its asset&apos;s move over the round.</li>
              <li><b>Priced together</b> — BTC, ETH and SOL usually move together over a few minutes, so a parlay is priced on the chance that all its legs land <em>jointly</em>, not by multiplying the legs as if they were independent. Legs in the same direction (BTC UP + ETH UP) pay modestly; legs that split (BTC UP + ETH DOWN) pay far more. Cash-outs use the same pricing.</li>
              <li><b>Correlation block</b> — one leg per asset.</li>
              <li><b>Variance fee</b> — the fee scales with the combined risk of the legs.</li>
              <li><b>Void fallback</b> — a leg voided at resolution counts as 0.5× instead of killing the ticket.</li>
            </ul>
            <p>Open tickets can be cashed out early at the current combined price:</p>
            <pre className="code">{`fair = shares × Π(current price of each leg's side)
fee  = min(fair × 2%, 1.50 USDC)
net  = fair − fee   → credited to your vault`}</pre>
            <p>Cash-out settles inside the arena vault; it is not a Panta order.</p>
          </Section>

          <Section id="panta" title="Panta integration">
            <p>
              All Panta calls are made server-side through Oracle Rumble&apos;s <code>/api/*</code> routes;
              the API key never reaches the browser. Requests carry the Oracle Rumble <code>X-User-Id</code>
              so trades are attributed.
            </p>
            <table className="docs-table">
              <thead><tr><th>Panta endpoint</th><th>Used for</th></tr></thead>
              <tbody>
                <tr><td><code>GET /markets/…</code></td><td>Market prices and status</td></tr>
                <tr><td><code>GET /positions/</code></td><td>Your arenas, positions and withdrawals</td></tr>
                <tr><td><code>POST /primaryorder{`{quote,build,submit,verify}`}/</code></td><td>Mirrored orders</td></tr>
                <tr><td><code>POST /claim/build/</code></td><td>Claiming a winning Panta position</td></tr>
                <tr><td><code>GET /trades/{`{signature}`}/</code></td><td>Attribution check</td></tr>
              </tbody>
            </table>
          </Section>

          <Section id="usernames" title="Usernames">
            <p>
              Your username is how other players see you on the arena stage, standings, activity
              feed and results. You&apos;re asked to set one when you first connect a wallet, and you can
              also type it straight into the host card or the seat dialog. Change it any time from
              the account button in the header.
            </p>
            <p>
              It must be 3–16 letters, numbers or underscores and unique within an arena
              (case-insensitive). It&apos;s saved on this device for your wallet.
            </p>
          </Section>

          <Section id="wallet" title="Wallets & signing">
            <p>
              Phantom, Backpack, Solflare and Brave Wallet are supported. Set the wallet to Solana {CLUSTER}. If more
              than one is installed, Connect asks which one to use and remembers it.
            </p>
            <ul>
              <li><b>Sign-in</b> — right after you connect, the wallet asks you to sign a free sign-in message (not a transaction). It proves the requests for your seat come from you; the session lasts a week on this browser and ends when you disconnect. If you skip it, you&apos;re asked again before your first seat or trade.</li>
              <li><b>After a reload</b> the page reconnects to your wallet without a prompt (for a site the wallet already trusts), so signing works straight away.</li>
              <li><b>Switching accounts</b> in the wallet switches the page to that account. If the wallet is on a different account from the one you&apos;re playing as, nothing is signed and the page tells you which account to switch to.</li>
              <li><b>Escrow deposit, claim and recover</b> are legacy transactions built by the server, checked with a dry run on Solana {CLUSTER} before your wallet sees them, and signed by you. The wallet only signs; the app sends the transaction to {CLUSTER} itself, so it lands on the right network whatever network your wallet is set to. Approve within about a minute; an older transaction expires and nothing is taken. The deposit carries a memo with the arena, the seat amount and the game type, visible in your wallet and on the explorer. It never includes your opening call or picks, since those stay hidden until the round starts.</li>
              <li><b>Panta orders and claims</b> are v0 transactions compiled in your browser from Panta&apos;s instructions.</li>
              <li>You pay the network fee for every transaction you sign. Private keys never leave your wallet.</li>
            </ul>
            <p>
              Before any deposit the server checks you hold enough devnet USDC for the seat and about
              0.005 SOL for fees, so the wallet never asks you to sign a transaction that would fail.
            </p>
          </Section>

          <Section id="api" title="API reference">
            <table className="docs-table">
              <thead><tr><th>Route</th><th>Purpose</th></tr></thead>
              <tbody>
                <tr><td><code>GET /api/arenas</code></td><td>Open arenas (enrolling, live, settling, advancing)</td></tr>
                <tr><td><code>GET /api/round?arena=</code></td><td>Round state, standings, cut line, UP price and live spot price for one arena</td></tr>
                <tr><td><code>POST /api/round</code></td><td>Open a new arena (creates its on-chain vault)</td></tr>
                <tr><td><code>POST /api/auth/challenge</code> · <code>/verify</code></td><td>Wallet sign-in (message signature → session cookie)</td></tr>
                <tr><td><code>POST /api/round/enroll</code></td><td>Take a seat (signed in); returns <code>needsDeposit</code> until your on-chain deposit exists, <code>pending</code> while it confirms</td></tr>
                <tr><td><code>POST /api/round/call</code></td><td>Change your opening UP/DOWN call while enrolling</td></tr>
                <tr><td><code>POST /api/round/picks</code></td><td>Change your predictions picks while enrolling (signed in)</td></tr>
                <tr><td><code>POST /api/round/cancel</code></td><td>Cancel an arena whose host never funded seat #1</td></tr>
                <tr><td><code>POST /api/round/trade</code></td><td>Buy UP/DOWN or sell inside the arena (signed in)</td></tr>
                <tr><td><code>POST /api/round/parlay</code> · <code>/cashout</code></td><td>Place or cash out a parlay</td></tr>
                <tr><td><code>GET /api/escrow/status</code></td><td>On-chain or practice mode</td></tr>
                <tr><td><code>GET /api/escrow/balance?wallet=</code></td><td>Devnet USDC and SOL for a wallet</td></tr>
                <tr><td><code>POST /api/escrow/tx</code></td><td>Unsigned deposit, claim or recover transaction</td></tr>
                <tr><td><code>POST /api/escrow/settle</code></td><td>Record final entitlements on-chain (idempotent)</td></tr>
                <tr><td><code>POST /api/orders/{`{quote,build,submit,verify}`}</code></td><td>Panta order proxies</td></tr>
                <tr><td><code>GET /api/portfolio?wallet=</code></td><td>A wallet&apos;s arenas: live positions, standings, and payouts or refunds to withdraw (game ledger + on-chain deposits)</td></tr>
                <tr><td><code>GET /api/positions?wallet=</code></td><td>Panta positions for a wallet</td></tr>
              </tbody>
            </table>
          </Section>

          <Section id="trust" title="Trust model">
            <table className="docs-table">
              <thead><tr><th>You rely on</th><th>For</th><th>If it fails</th></tr></thead>
              <tbody>
                <tr><td>Escrow program</td><td>Holding deposits</td><td>Funds only move with your signature</td></tr>
                <tr><td>Oracle Rumble server</td><td>Running rounds and recording results</td><td>Recover returns your full seat after the deadline</td></tr>
                <tr><td>Price oracle (Coinbase, Kraken)</td><td>Opening and closing prices</td><td>The round waits up to a minute, then settles at 50¢ both ways</td></tr>
                <tr><td>Panta</td><td>Positions and mirrored orders</td><td>Arena trading is unaffected</td></tr>
                <tr><td>Your wallet</td><td>Every signature</td><td>Nothing moves without it</td></tr>
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
                <summary>Can the host take my deposit?</summary>
                <p>No. The host only chooses the settings. Deposits sit in the escrow program and only your signature can withdraw them.</p>
              </details>
              <details>
                <summary>Do I have to pick UP or DOWN when I sit down?</summary>
                <p>No — choose <em>decide later</em> and trade once the round is live. If you do pick, the share of your vault you choose (a quarter, half or all of it) goes on that side at the opening price, and you can still switch or sell during the round. Predictions arenas have no call: you answer five questions instead.</p>
              </details>
              <details>
                <summary>In a Predictions arena, can anyone see my picks before the start?</summary>
                <p>No. Until the round locks, other players only see how many of the five questions you have answered. Your picks aren&apos;t in the public deposit transaction either. Once the round starts, every player&apos;s picks are shown.</p>
              </details>
              <details>
                <summary>What if I close the tab mid-round?</summary>
                <p>Your position stays open and is closed at the final price like everyone else&apos;s. Come back after the round to withdraw.</p>
              </details>
              <details>
                <summary>Why not trade on Panta directly?</summary>
                <p>You can. Oracle Rumble adds the game: equal seats, a shared pool, live rankings and eliminations.</p>
              </details>
              <details>
                <summary>Is Oracle Rumble part of Panta?</summary>
                <p>No. It is an independent product built on the Panta Public API for the Panta API Sidetrack of the Colosseum hackathon.</p>
              </details>
            </div>
          </Section>

          <footer className="docs-foot">
            <div>Oracle Rumble · Solana {CLUSTER} · Built on Panta</div>
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
      {showUsername && (
        <UsernameModal
          initial={username}
          onSave={(v) => { const r = saveUsername(v); if (r.ok) setToast(r.message); return r; }}
          onClose={() => setShowUsername(false)}
        />
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
