"use client";

/**
 * /docs — Oracle Rumble protocol + technical documentation.
 * Section-anchored long-read with sticky sidebar TOC, in the game aesthetic.
 * Content is deliberately verbose and technical: economics, on-chain model,
 * Panta integration lifecycle, API endpoints, trust model, recovery clause.
 */

import { useEffect } from "react";

const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").toLowerCase();

const SECTIONS: { id: string; title: string }[] = [
  { id: "overview", title: "Overview" },
  { id: "game", title: "Game format" },
  { id: "seat", title: "Seat & prize model" },
  { id: "escrow", title: "Non-custodial escrow" },
  { id: "panta", title: "Panta integration" },
  { id: "lifecycle", title: "Order lifecycle" },
  { id: "markets", title: "Markets & resolution" },
  { id: "parlays", title: "Parlays & cash-out" },
  { id: "attribution", title: "Attribution & fees" },
  { id: "wallet", title: "Wallet & signing" },
  { id: "api", title: "API endpoints" },
  { id: "trust", title: "Trust model" },
  { id: "recovery", title: "Recovery clause" },
  { id: "roadmap", title: "Roadmap" },
  { id: "faq", title: "FAQ" }
];

export default function DocsPage() {
  useEffect(() => {
    document.body.classList.add("game-mode");
    return () => { document.body.classList.remove("game-mode"); };
  }, []);

  return (
    <main className="game-main">
      <div className="game-grid-bg" aria-hidden="true" />
      <div className="game-scanlines" aria-hidden="true" />

      {/* Minimal tabbar for docs */}
      <nav className="hud-bar game-hud">
        <div className="tabbar-inner">
          <a href="/" className="brand" aria-label="Oracle Rumble">
            <svg className="mark" viewBox="0 0 64 64" aria-hidden="true">
              <g fill="none" stroke="#edf0f6" strokeWidth="3.2" strokeLinecap="round">
                <path d="M 12 24 A 22 22 0 0 1 24 12" />
                <path d="M 40 12 A 22 22 0 0 1 52 24" />
                <path d="M 52 40 A 22 22 0 0 1 40 52" />
                <path d="M 24 52 A 22 22 0 0 1 12 40" />
              </g>
              <path d="M 4 32 L 11 32 M 53 32 L 60 32" stroke="#edf0f6" strokeWidth="3" strokeLinecap="round" />
              <path d="M 32 2 L 36 18 L 32 23 L 28 18 Z" fill="#edf0f6" />
              <path d="M 32 62 L 36 46 L 32 41 L 28 46 Z" fill="#edf0f6" />
              <path d="M 10 32 C 18 20, 26 18, 32 18 C 38 18, 46 20, 54 32 C 46 44, 38 46, 32 46 C 26 46, 18 44, 10 32 Z" fill="#edf0f6" />
              <circle cx="32" cy="32" r="7" fill="#0a0d13" />
              <circle cx="32" cy="32" r="3.3" fill="#edf0f6" />
            </svg>
            ORACLE RUMBLE
          </a>
          <div className="hud-nav">
            <a href="/">Arenas</a>
            <a href="/#host">Host</a>
            <a href="/positions">Positions</a>
            <a href="/docs" className="active">Docs</a>
          </div>
          <div className="hud-right">
            <a href="/" className="btn-host" style={{ height: 34, padding: "0 14px", fontSize: 11 }}>← Arenas</a>
          </div>
        </div>
      </nav>

      <section className="docs-hero">
        <div className="gm-eyebrow">
          <span className="live-dot" />
          <span>Protocol documentation</span>
          <span className="sep">·</span>
          <span>v0.9 · devnet</span>
        </div>
        <h1 className="game-title">
          <span className="lash">Read the</span> <span className="kill">rules</span>.
        </h1>
        <p className="sublead">
          The full protocol behind Oracle Rumble — game format, on-chain escrow, Panta market
          integration, order lifecycle, parlays, attribution, and recovery. Written for players,
          hosts, and integrators who want to know exactly what happens when they click{" "}
          <b>Enter arena</b>.
        </p>
      </section>

      <div className="docs-shell">
        <aside className="docs-toc">
          <div className="toc-head">Contents</div>
          <ul>
            {SECTIONS.map((s) => (
              <li key={s.id}><a href={`#${s.id}`}>{s.title}</a></li>
            ))}
          </ul>
          <div className="toc-foot">
            <a href="/" className="btn-host" style={{ height: 38, fontSize: 11, padding: "0 14px" }}>← Back to arenas</a>
          </div>
        </aside>

        <article className="docs-article">
          <Section id="overview" title="Overview">
            <p>
              <b>Oracle Rumble</b> is a battle-royale prediction market on Solana. It turns Panta&apos;s
              on-chain markets into a game with a fixed seat cost, a shared prize pool, and a simple
              rule: every entrant pays the same, every entrant trades the same market, and only
              the survivors keep the pool.
            </p>
            <p>
              Under the hood it is three things stitched together:
            </p>
            <ol>
              <li>
                <b>An arena engine</b> — server-side round state (enrolling → live → settling →
                complete) with a non-custodial USDC escrow on Solana {CLUSTER}.
              </li>
              <li>
                <b>A Panta integration</b> — real quotes, buys, claims, and creation of new markets
                against the live Panta Public API (<code>live-api.panta.market/api/v1</code>).
              </li>
              <li>
                <b>A trading UI</b> — Buy UP / Buy DOWN, parlays across BTC / ETH / SOL, and early
                cash-out with a variance-based fee.
              </li>
            </ol>
            <div className="callout">
              <b>Devnet by default.</b> Everything here runs on Solana devnet USDC and Panta&apos;s
              devnet markets. Prize amounts are real devnet USDC; nothing settles to mainnet.
            </div>
          </Section>

          <Section id="game" title="Game format">
            <p>
              A rumble has two shapes:
            </p>
            <table className="docs-table">
              <thead>
                <tr><th>Format</th><th>Rounds</th><th>Elimination</th><th>Best for</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td><b>Single</b></td>
                  <td>1</td>
                  <td>Top half by vault balance at settlement wins</td>
                  <td>5–15 min sessions on 5m / 15m markets</td>
                </tr>
                <tr>
                  <td><b>Royale</b></td>
                  <td>2–4</td>
                  <td>Bottom half cut each round; survivors carry vault forward</td>
                  <td>Longer arcs on hourly / daily markets, 8–16 players</td>
                </tr>
              </tbody>
            </table>
            <p>
              Every round follows the same lifecycle:
            </p>
            <div className="lifecycle-strip">
              {["Enrolling", "Live", "Settling", "Advancing / Complete"].map((s, i) => (
                <div key={s} className="ls-step">
                  <span className="ls-num">{String(i + 1).padStart(2, "0")}</span>
                  <span className="ls-lab">{s}</span>
                </div>
              ))}
            </div>
            <ul>
              <li><b>Enrolling</b> — seat sales open. Ends at the enrollment deadline or when capacity fills.</li>
              <li><b>Live</b> — trading window opens on the Panta market. Every player gets the same starting vault.</li>
              <li><b>Settling</b> — Panta&apos;s AI resolver returns the outcome; the server ranks vaults and computes payouts.</li>
              <li><b>Advancing</b> (royale only) — survivors move to the next round; vault balances carry over.</li>
              <li><b>Complete</b> — final winners claim their share of the pool from the escrow program.</li>
            </ul>
          </Section>

          <Section id="seat" title="Seat & prize model">
            <p>The seat is deliberately transparent — no hidden fees, no rake unless it&apos;s printed:</p>
            <pre className="code">{`seat = entry + starting_vault
pool = entry × capacity

// starting_vault stays yours to trade with. It never enters the shared pool.
// entry funds the prize pool split at the end.`}</pre>
            <p>
              At settlement, the prize pool splits pro-rata across the survivors weighted by vault
              balance. For a single-round game with 8 seats at $2 entry, the pool is $16, split
              across the top 4 vaults.
            </p>
            <div className="callout">
              <b>What&apos;s at risk.</b> Only the <b>entry</b> is at risk. Your starting vault is a
              trading budget — its P&amp;L determines your ranking but the vault itself isn&apos;t taken
              from you. Your final payout is <em>rank share of the pool</em>, not vault + pool.
            </div>
          </Section>

          <Section id="escrow" title="Non-custodial escrow">
            <p>
              Seats and prizes flow through an on-chain escrow program on Solana {CLUSTER}. The
              program holds the deposited USDC in a per-arena vault PDA and only releases it on
              two paths:
            </p>
            <ol>
              <li><b>Winner claim</b> — a settled arena&apos;s survivor signs a claim tx and receives their pro-rata share.</li>
              <li><b>Cancel recovery</b> — if the arena is cancelled (host bails, resolver stalls beyond a bounded window), every enrollee can reclaim their exact entry unchanged.</li>
            </ol>
            <p>
              Deposits are user-signed. The host cannot move funds. There is no admin key with
              custodial authority over deposited USDC. If the server disappears, the recovery path
              on-chain still lets participants withdraw their seat.
            </p>
            <div className="callout warn">
              <b>Practice mode.</b> When the deployer&apos;s <code>ESCROW_HOST_SECRET_KEY</code> is not
              set, arenas run in practice mode: seat deposits are not requested, ranking and UX
              still work, but there is no on-chain USDC movement. The header chip shows{" "}
              <code>on-chain</code> vs <code>practice</code>.
            </div>
          </Section>

          <Section id="panta" title="Panta integration">
            <p>
              Every real trade in Oracle Rumble is a Panta trade. The server proxies to Panta&apos;s
              Public API (<code>https://live-api.panta.market/api/v1</code>) with an{" "}
              <code>X-Api-Key</code> and an <code>X-User-Id</code> for attribution.
            </p>
            <p>Endpoint surface that Oracle Rumble uses:</p>
            <table className="docs-table">
              <thead><tr><th>Panta path</th><th>Purpose</th></tr></thead>
              <tbody>
                <tr><td><code>GET /categories/</code></td><td>Enum of allowed market categories for creation.</td></tr>
                <tr><td><code>GET /markets/…</code></td><td>Market catalog + phase + AI resolver metadata.</td></tr>
                <tr><td><code>GET /positions/</code></td><td>Wallet holdings with claim eligibility.</td></tr>
                <tr><td><code>POST /primaryorderquote/</code></td><td>Simulate a fill and open a quote session.</td></tr>
                <tr><td><code>POST /primaryorderbuild/</code></td><td>Return Solana <code>instructions[]</code> + <code>recentBlockhash</code>.</td></tr>
                <tr><td><code>POST /primaryordersubmit/</code></td><td>Register a broadcast signature against an <code>orderId</code>.</td></tr>
                <tr><td><code>POST /primaryorderverify/</code></td><td>Poll until <code>confirmed | failed | expired</code>.</td></tr>
                <tr><td><code>POST /claim/build/</code></td><td>Return claim instructions for a winning position.</td></tr>
                <tr><td><code>GET /trades/{`{signature}`}/</code></td><td>Attribution readback after a broadcast.</td></tr>
              </tbody>
            </table>
            <p>
              The API key never touches the browser. All Panta calls are made server-side from
              Next.js API routes; the client only ever talks to Oracle Rumble&apos;s own{" "}
              <code>/api/*</code> proxies.
            </p>
          </Section>

          <Section id="lifecycle" title="Order lifecycle">
            <p>
              When a player clicks <b>Buy UP</b> or <b>Buy DOWN</b> on a real Panta market, the
              client walks a six-step lifecycle:
            </p>
            <ol className="lifecycle-list">
              <li><b>Quote</b> — <code>POST /api/orders/quote</code> → Panta <code>/primaryorderquote/</code>. Returns fill price in cents, expected shares, fee, quote id.</li>
              <li><b>Build</b> — <code>POST /api/orders/build</code> → Panta <code>/primaryorderbuild/</code>. Returns raw <code>instructions[]</code>, <code>recentBlockhash</code>, and an <code>orderId</code>.</li>
              <li><b>Sign</b> — the client compiles a v0 <code>VersionedTransaction</code> locally with the wallet as fee payer and asks the wallet to sign + send.</li>
              <li><b>Submit</b> — <code>POST /api/orders/submit</code> passes the broadcast signature + orderId back to Panta.</li>
              <li><b>Verify</b> — <code>POST /api/orders/verify</code> polls Panta until status is terminal (<code>confirmed</code> / <code>failed</code> / <code>expired</code>).</li>
              <li><b>Attribute</b> — <code>GET /api/trades/report</code> reads <code>/trades/{`{sig}`}/</code>. When status is <code>processed</code> / <code>confirmed</code>, attribution ticks.</li>
            </ol>
            <p>
              Every step is surfaced live in the trade panel via the <code>PantaOrderStatus</code>
              component — a 7-dot progress row that lights up as the tx moves through Panta.
            </p>
            <div className="callout">
              <b>Panta returns instructions, not transactions.</b> Unlike some order routers,
              Panta&apos;s build endpoint returns raw Solana instruction data. The client compiles the
              v0 message and picks the fee payer. This means the wallet always signs a transaction
              it fully controls — no opaque pre-serialized blob.
            </div>
          </Section>

          <Section id="markets" title="Markets & resolution">
            <p>
              Oracle Rumble arenas run over three market families:
            </p>
            <ul>
              <li><b>Directional micro-markets</b> — will BTC / ETH / SOL close UP or DOWN over 5m, 15m, 1h, or 1d. These are the default arena feed.</li>
              <li><b>Panta catalog markets</b> — any live Panta market with a real market id (base58 pubkey) can back an arena. Hosts pick from the live catalog.</li>
              <li><b>Host-created Panta markets</b> — hosts with a Panta wallet can spin up a new market via the create-market flow (question, category, image, resolution time). The market lives on Panta forever after; the arena is one game played over it.</li>
            </ul>
            <p>
              Resolution is Panta&apos;s AI Resolver. When the market&apos;s <code>resolutionTime</code>
              passes, Panta&apos;s resolver posts an outcome (<code>YES</code> / <code>NO</code>) and a
              dispute window opens. Oracle Rumble surfaces resolution + dispute window in the
              <code>PantaResolution</code> banner and delays claim payouts until the dispute
              window closes.
            </p>
          </Section>

          <Section id="parlays" title="Parlays & cash-out">
            <p>
              Parlays let a player stack 2–5 legs across the live BTC / ETH / SOL markets in one
              ticket. Design principles borrowed from parlayit:
            </p>
            <ul>
              <li><b>Correlation blocks.</b> The same asset on the same horizon can appear on only one side per ticket (no free arbitrage against yourself).</li>
              <li><b>Variance-based fee.</b> The parlay quote fee scales with the joint variance of legs, not a fixed vig.</li>
              <li><b>50/50 fallback.</b> If a leg&apos;s implied probability is missing, it settles at 50/50 for that ticket.</li>
              <li><b>Cash-out any time.</b> A player can end a ticket early — the payout is <code>shares × Π(current side prob)</code>, minus a small fee.</li>
            </ul>
            <p>Cash-out fee model:</p>
            <pre className="code">
{`fair  = shares × Π(currentSideProb over open legs)
fee   = min(fair × CASHOUT_FEE_RATE, CASHOUT_FEE_CAP_USDC)
net   = fair - fee

CASHOUT_FEE_RATE       = 0.02  (2%)
CASHOUT_FEE_CAP_USDC   = 1.50  (hard cap)`}
            </pre>
            <p>
              Cash-out mutates round state atomically via a <code>SELECT ... FOR UPDATE</code> lock
              on the arena&apos;s row in Postgres, then triggers a Panta sell-order lifecycle on each
              open leg. The parlay ticket moves to status <code>cashed_out</code> with a
              <code>cashedOutAt</code> timestamp.
            </p>
          </Section>

          <Section id="attribution" title="Attribution & fees">
            <p>
              Panta credits every trade to the account owning the API key that made the order
              build. Oracle Rumble also passes <code>X-User-Id: usr_…</code> on every request so
              attribution is deterministic across environments.
            </p>
            <p>
              After the tx confirms, the client hits <code>GET /trades/{`{sig}`}/</code> as an
              attribution readback. When Panta returns <code>status: processed | confirmed</code>{" "}
              with a matching wallet, the HUD attribution counter ticks.
            </p>
            <p>Fee stack a player sees on a Buy UP for $10:</p>
            <table className="docs-table">
              <thead><tr><th>Fee</th><th>Who takes it</th><th>Typical size</th></tr></thead>
              <tbody>
                <tr><td>Panta trade fee</td><td>Panta (bundled in <code>feeUsdc</code>)</td><td>~0.5–1.5%</td></tr>
                <tr><td>Solana network fee</td><td>Solana validators</td><td>~$0.0001</td></tr>
                <tr><td>Oracle Rumble seat</td><td>Prize pool (not the host)</td><td>set by host</td></tr>
              </tbody>
            </table>
          </Section>

          <Section id="wallet" title="Wallet & signing">
            <p>Supported wallets on Solana {CLUSTER}:</p>
            <ul>
              <li><b>Phantom</b> — signAndSendTransaction, versioned tx support</li>
              <li><b>Backpack</b> — same interface</li>
              <li><b>Solflare</b> — same interface</li>
            </ul>
            <p>
              Every signed transaction is a v0 <code>VersionedTransaction</code>. Legacy
              transactions aren&apos;t used. The wallet is always the fee payer for trade + claim
              txs; the escrow host pays the recovery tx fee if a cancel happens.
            </p>
            <p>
              The client never uploads private keys. The only material that leaves the browser is
              the connected public key and, when a trade fires, the signed transaction bytes to
              the RPC endpoint via the wallet extension.
            </p>
          </Section>

          <Section id="api" title="API endpoints">
            <p>All server routes live under <code>/api/</code>. All are GET unless marked POST.</p>
            <table className="docs-table">
              <thead><tr><th>Route</th><th>Purpose</th></tr></thead>
              <tbody>
                <tr><td><code>GET /api/arenas</code></td><td>List active arenas (enrolling / live / settling / advancing).</td></tr>
                <tr><td><code>GET /api/markets/live</code></td><td>Live BTC/ETH/SOL directional markets.</td></tr>
                <tr><td><code>GET /api/categories</code></td><td>Panta market categories for the create-market flow.</td></tr>
                <tr><td><code>GET /api/positions?wallet=</code></td><td>Wallet holdings from Panta + claim eligibility.</td></tr>
                <tr><td><code>GET /api/escrow/status</code></td><td>Is on-chain escrow active, or is the server in practice mode?</td></tr>
                <tr><td><code>POST /api/round</code></td><td>Create a new arena (host action).</td></tr>
                <tr><td><code>POST /api/round/enroll</code></td><td>Buy a seat + deposit into escrow.</td></tr>
                <tr><td><code>POST /api/round/trade</code></td><td>Internal-vault trade (non-Panta) for practice arenas.</td></tr>
                <tr><td><code>POST /api/round/parlay</code></td><td>Open a parlay ticket.</td></tr>
                <tr><td><code>POST /api/round/parlay/cashout</code></td><td>Atomic early exit — reads inside SELECT FOR UPDATE lock.</td></tr>
                <tr><td><code>POST /api/orders/{`{quote,build,submit,verify}`}</code></td><td>Panta primary-order lifecycle proxies.</td></tr>
                <tr><td><code>POST /api/claims/build</code></td><td>Panta claim tx for a winning position.</td></tr>
                <tr><td><code>GET /api/trades/report?sig=</code></td><td>Attribution readback.</td></tr>
                <tr><td><code>GET /api/panta/telemetry</code></td><td>Ring-buffer of the last N Panta calls with status + latency.</td></tr>
              </tbody>
            </table>
          </Section>

          <Section id="trust" title="Trust model">
            <p>What you have to trust, and what you don&apos;t:</p>
            <table className="docs-table">
              <thead><tr><th>Component</th><th>Trust required?</th><th>Why</th></tr></thead>
              <tbody>
                <tr><td>Solana validators</td><td>Standard chain trust</td><td>Same as any Solana app.</td></tr>
                <tr><td>Escrow program</td><td>Code is public; per-arena vault PDA is deterministic</td><td>Non-custodial; recovery path is on-chain.</td></tr>
                <tr><td>Oracle Rumble server</td><td>For matchmaking + ranking</td><td>If the server dies, on-chain recovery still returns entry.</td></tr>
                <tr><td>Panta API</td><td>For market catalog + order routing</td><td>Panta is the market maker; outcomes are their AI Resolver&apos;s call.</td></tr>
                <tr><td>Panta AI Resolver</td><td>For market outcomes</td><td>Dispute window applies; Panta&apos;s process governs disputes.</td></tr>
                <tr><td>Your wallet</td><td>For every signature</td><td>Every trade + claim needs your signature.</td></tr>
              </tbody>
            </table>
          </Section>

          <Section id="recovery" title="Recovery clause">
            <p>
              An arena can enter a <code>cancelled</code> state under three conditions:
            </p>
            <ol>
              <li>The host cancels manually while status is <code>enrolling</code>.</li>
              <li>Enrollment closes with fewer than 2 seats sold.</li>
              <li>The market fails to resolve within the resolver&apos;s bounded window (fallback path).</li>
            </ol>
            <p>
              Once cancelled, every enrollee&apos;s seat becomes claimable via the escrow program.
              The claim returns the exact entry amount that was deposited — no fees, no partial
              refunds. The starting_vault portion of the seat was never on-chain; it&apos;s a soft
              trading budget that has no recovery obligation.
            </p>
          </Section>

          <Section id="roadmap" title="Roadmap">
            <ul>
              <li><b>Mainnet</b> — port escrow program to Solana mainnet USDC once devnet coverage plateaus.</li>
              <li><b>Player levels</b> — persistent XP + rank across sessions.</li>
              <li><b>Squad rumbles</b> — team-vs-team format with shared vaults.</li>
              <li><b>Prediction leagues</b> — persistent seasons with weekly cutoffs.</li>
              <li><b>Public API</b> — read-only endpoints for third-party dashboards.</li>
            </ul>
          </Section>

          <Section id="faq" title="FAQ">
            <div className="faq">
              <details open>
                <summary>Is this real money?</summary>
                <p>On devnet it&apos;s real devnet USDC, which is free to obtain from any Solana faucet. Mainnet is on the roadmap.</p>
              </details>
              <details>
                <summary>Can the host see my wallet balance or steal my seat?</summary>
                <p>No. The host can create arenas but has no authority over the escrow PDA. Every deposit and every claim is signed by the depositor.</p>
              </details>
              <details>
                <summary>What happens if I disconnect mid-round?</summary>
                <p>Your vault stays where it is. If the market resolves in your favor and your ranking survives, you can come back and claim later. If the round is cancelled, you can always recover your entry from the escrow.</p>
              </details>
              <details>
                <summary>Why not just trade Panta directly?</summary>
                <p>You can — Panta is the underlying market. Oracle Rumble adds a fixed-seat game layer, ranking, prize splits, and parlays around it, so a $2 seat with 8 players creates a $16 prize dynamic that a bare market doesn&apos;t have.</p>
              </details>
              <details>
                <summary>Is Oracle Rumble affiliated with Panta?</summary>
                <p>Oracle Rumble is an independent product built on the Panta Public API, submitted to the Panta API Sidetrack of the Colosseum Crypto World&apos;s Fair hackathon.</p>
              </details>
              <details>
                <summary>What tech stack?</summary>
                <p>Next.js 15 App Router, Solana web3.js, Postgres (via <code>lib/round-store.ts</code>), Panta Public API v1, and the standard wallet adapters (Phantom / Backpack / Solflare).</p>
              </details>
            </div>
          </Section>

          <footer className="docs-foot">
            <div>Oracle Rumble · Solana {CLUSTER} · Non-custodial escrow · Built on Panta.</div>
            <div><a href="/">← Back to arenas</a></div>
          </footer>
        </article>
      </div>
    </main>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="doc-sec">
      <h2>{title}<a href={`#${id}`} aria-label={`Anchor for ${title}`}>#</a></h2>
      {children}
    </section>
  );
}
