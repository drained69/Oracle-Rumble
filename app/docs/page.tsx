"use client";

/**
 * /docs — how Oracle Rumble works: game rules, money flow, escrow, Panta
 * integration, and the API. Every statement here should match the code.
 */

import { useCallback, useEffect, useState } from "react";
import { useEscrowStatus, useWalletIdentity } from "@/lib/use-wallet";
import SiteHeader from "@/app/SiteHeader";
import CallsignModal from "@/app/CallsignModal";
import GitHubLink from "@/app/GitHubLink";

const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").toLowerCase();
const PROGRAM_ID = process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID ?? "";

const SECTIONS: { id: string; title: string }[] = [
  { id: "overview", title: "Overview" },
  { id: "rules", title: "Game rules" },
  { id: "money", title: "Seats, pool & payouts" },
  { id: "escrow", title: "Non-custodial escrow" },
  { id: "recovery", title: "Cancellations & recovery" },
  { id: "trading", title: "Trading in an arena" },
  { id: "parlays", title: "Parlays & cash-out" },
  { id: "panta", title: "Panta integration" },
  { id: "callsigns", title: "Callsigns" },
  { id: "wallet", title: "Wallets & signing" },
  { id: "api", title: "API reference" },
  { id: "trust", title: "Trust model" },
  { id: "faq", title: "FAQ" }
];

export default function DocsPage() {
  const { wallet, callsign, toggleConnect, saveCallsign } = useWalletIdentity();
  const escrow = useEscrowStatus();
  const [showCallsign, setShowCallsign] = useState(false);
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
    if (r.needsCallsign) setShowCallsign(true);
  }, [toggleConnect]);

  return (
    <main className="game-main">
      <div className="game-grid-bg" aria-hidden="true" />
      <div className="game-scanlines" aria-hidden="true" />

      <SiteHeader
        active="docs"
        wallet={wallet}
        callsign={callsign}
        escrow={escrow}
        onConnect={connect}
        onEditCallsign={() => setShowCallsign(true)}
      />

      <section className="page-hero">
        <p className="jt-eyebrow">Documentation</p>
        <h1><span className="hl-a">How</span> Oracle Rumble <span className="hl-b">works</span></h1>
        <p className="page-lead">
          The rules of an arena, where your USDC goes, how the escrow protects it, and how trades
          reach Panta. Written for players, hosts and integrators.
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
              same seat, trade the same live market, and are ranked by vault value. At the end of
              each round the bottom half is eliminated; the finalists split the prize pool.
            </p>
            <ol>
              <li><b>Arena engine</b> — server-side rounds (enrolling → live → settling → advancing/complete) persisted in Postgres.</li>
              <li><b>USDC escrow</b> — a non-custodial Solana program holds every seat deposit until players withdraw.</li>
              <li><b>Panta</b> — market prices, and optional mirrored orders on Panta&apos;s primary book.</li>
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
              <li><b>Enrolling</b> — seats are open. <em>Quick</em> arenas lock after 30 seconds; <em>Scheduled</em> arenas stay open for the chosen window (5 minutes to 3 hours). Fewer than 2 players at lock cancels the round.</li>
              <li><b>Live</b> — everyone trades YES/NO on the same market with the same starting vault. The arena shows who is above and below the cut in real time.</li>
              <li><b>Settling</b> — open positions are closed at the market&apos;s YES price when the timer ends (100¢ or 0¢ if the market has a hard outcome). Players are ranked by vault value; ties go to whoever joined first.</li>
              <li><b>Cut</b> — the top <code>ceil(alive / 2)</code> players survive. Everyone else is eliminated for that round.</li>
              <li><b>Complete</b> — the arena settles on-chain and every player can withdraw.</li>
            </ul>
          </Section>

          <Section id="money" title="Seats, pool & payouts">
            <pre className="code">{`seat      = entry + vault          (both deposited into escrow)
pool      = entry × players who paid
withdraw  = remaining vault + prize share`}</pre>
            <table className="docs-table">
              <thead><tr><th>Players</th><th>Prize split</th></tr></thead>
              <tbody>
                <tr><td>2 (a duel)</td><td>Winner takes 100% of the pool</td></tr>
                <tr><td>3 or more</td><td>1st 62.5% · 2nd 23.44% · 3rd 14.06%</td></tr>
              </tbody>
            </table>
            <p>
              The <b>entry</b> is what you put at risk for the prize. The <b>vault</b> is your trading
              bankroll: it rises and falls with your trades and whatever is left is yours to withdraw,
              whether or not you finish in the money. Oracle Rumble takes no cut of the pool.
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
              <li><b>Claim</b> — after settlement you sign to withdraw your remaining vault plus prize.</li>
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
              <li><b>Host doesn&apos;t fund seat #1</b> — if the host rejects or fails the deposit, the arena is cancelled before anyone else can join.</li>
              <li><b>Not enough players</b> — fewer than 2 players when enrollment locks cancels the round.</li>
              <li><b>Settlement never happens</b> — one hour after enrollment closes, any depositor can call Recover and receive their full seat (entry + vault).</li>
            </ul>
          </Section>

          <Section id="trading" title="Trading in an arena">
            <p>
              Buying YES or NO moves USDC from your vault into shares at the current price; selling
              closes the position at the live mark. Your vault value — cash plus marked positions —
              decides your rank and is what the cut line compares.
            </p>
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
              <li><b>2–5 legs</b> across the live BTC, ETH and SOL markets, paid from your vault.</li>
              <li><b>Correlation block</b> — legs from the same correlation group can&apos;t be combined.</li>
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
                <tr><td><code>GET /positions/</code></td><td>The Positions page</td></tr>
                <tr><td><code>POST /primaryorder{`{quote,build,submit,verify}`}/</code></td><td>Mirrored orders</td></tr>
                <tr><td><code>POST /claim/build/</code></td><td>Claiming a winning Panta position</td></tr>
                <tr><td><code>GET /trades/{`{signature}`}/</code></td><td>Attribution check</td></tr>
              </tbody>
            </table>
          </Section>

          <Section id="callsigns" title="Callsigns">
            <p>
              Your callsign is your public name on the arena stage, standings, activity feed and
              results. It must be 3–16 letters, numbers or underscores, unique within an arena
              (case-insensitive), and is saved on this device for your wallet.
            </p>
          </Section>

          <Section id="wallet" title="Wallets & signing">
            <p>Phantom, Backpack and Solflare are supported. Set the wallet to Solana {CLUSTER}.</p>
            <ul>
              <li><b>Escrow deposit, claim and recover</b> are legacy transactions built by the server and signed by you.</li>
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
                <tr><td><code>GET /api/round?arena=</code></td><td>Round state, standings, cut line and price for one arena</td></tr>
                <tr><td><code>POST /api/round</code></td><td>Open a new arena (creates its on-chain vault)</td></tr>
                <tr><td><code>POST /api/round/enroll</code></td><td>Take a seat; returns <code>needsDeposit</code> until the deposit signature is supplied</td></tr>
                <tr><td><code>POST /api/round/cancel</code></td><td>Cancel an arena whose host never funded seat #1</td></tr>
                <tr><td><code>POST /api/round/trade</code></td><td>Buy YES/NO or sell inside the arena</td></tr>
                <tr><td><code>POST /api/round/parlay</code> · <code>/cashout</code></td><td>Place or cash out a parlay</td></tr>
                <tr><td><code>GET /api/escrow/status</code></td><td>On-chain or practice mode</td></tr>
                <tr><td><code>GET /api/escrow/balance?wallet=</code></td><td>Devnet USDC and SOL for a wallet</td></tr>
                <tr><td><code>POST /api/escrow/tx</code></td><td>Unsigned deposit, claim or recover transaction</td></tr>
                <tr><td><code>POST /api/escrow/settle</code></td><td>Record final entitlements on-chain (idempotent)</td></tr>
                <tr><td><code>POST /api/orders/{`{quote,build,submit,verify}`}</code></td><td>Panta order proxies</td></tr>
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
                <tr><td>Panta</td><td>Market prices and mirrored orders</td><td>Arena trading continues on the last known price</td></tr>
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
      {showCallsign && (
        <CallsignModal
          initial={callsign}
          onSave={(v) => { const r = saveCallsign(v); if (r.ok) setToast(r.message); return r; }}
          onClose={() => setShowCallsign(false)}
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
