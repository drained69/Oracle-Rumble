# The Pit mainnet release audit — 10 October 2026

## Current decision: NO GO

The product is still configured for devnet and a Panta sandbox key. This review
found a fund-lock race in escrow settlement and several live API paths that
reported mock success after Panta failures. Fixes are in this working tree,
but they have not been exercised in a full devnet deposit → trade → settle →
claim/recover test. Do not route real USDC through this build yet.

This is a code review and local test pass, not an independent smart contract
audit or a guarantee that all vulnerabilities have been found.

## Changes made in this pass

- `CloseSettlement` and `CloseRefund` now require every unique on-chain
  depositor entry to be settled or recovered, checked atomically with the
  on-chain deposit counter. Settlement must allocate every remaining USDC
  base unit. A recovered entry can no longer be settled a second time.
- The server supplies all depositor accounts to the close instruction.
- `Deposit` now requires the round operator's signature. The server only
  co-signs an enrolling wallet after its X/profile and balance checks, so
  a direct unauthenticated program call cannot consume capacity.
- Live Panta order, claim, position, market, category, and trade-history errors
  no longer fall back to fabricated data. An unconfirmed order is not shown
  as confirmed, and a Panta order starts only after its pit trade succeeds.
- Paid hosting requires persistent storage; mainnet hosting also requires a
  live Panta key, canonical mainnet USDC mint, escrow, Privy, and session
  secret. The read-only `npm run preflight:mainnet` checks configuration and
  on-chain program/mint identities in the intended release environment.
- A trade is rejected if its round changes while its price is being fetched.

## Blocking work before a real-funds launch

1. **On-chain admission integration:** the new operator co-signing path has
   compiled but has not been exercised with a Privy wallet. Upgrade the
   devnet program to this exact bytecode, then test a valid co-signed deposit,
   expired transaction retry, and direct unsigned/hostless hostile deposit.
   A server endpoint check alone cannot block direct program calls.
2. **Independent escrow review and tests:** commission an external Solana
   program audit. Add program integration tests covering deposits during
   settlement, recovered entries, duplicate entries, conservation, host
   compromise, fee accounts, and timeout recovery. The current Rust suite
   has one local unit test for the close-account proof; no program-test suite.
3. **Production infrastructure:** provision a dedicated mainnet RPC with
   indexing support for `getProgramAccounts`, durable Postgres with backup
   and restore drill, a live Panta key, production Privy app, independent
   session secret, and isolated operator/deployer/upgrade keys. Set the
   canonical mainnet USDC mint. Confirm the RPC genesis hash and the deployed
   program's executable account with `npm run preflight:mainnet`.
4. **Realistic canary:** run the exact build through a complete devnet cycle,
   then a limited mainnet canary with capped deposits and monitored operator
   balance, transaction landing, settlement, and user claims. Verify a
   recovery after the deadline in a controlled test. Record signatures.
5. **Legal and operations:** get jurisdiction-specific advice on the paid
   prediction/competition model, access restrictions, KYC/AML obligations,
   disclosures, dispute handling, support, incident response, and fund
   recovery before allowing public real-money play.

## Verification completed locally

- `npm run lint` — passed.
- `npm run build` — passed.
- `cargo test --locked --offline` — passed, one close-account regression test.
- `cargo-build-sbf` — passed with the local Solana v1.54 toolchain; the `.so`
  was generated at `program/target/deploy/oracle_rumble_escrow.so`.
- `npm run preflight:mainnet` — failed as intended against the current devnet
  environment (cluster, RPC, USDC mint, database, live Panta key, Privy,
  session secret). No keys or secret values were printed.

## Release order after blockers are resolved

1. Freeze a reviewed Git commit, run the full test suite and SBF build from
   that commit, and preserve the bytecode hash. Keep the devnet and mainnet
   program IDs and keys separate unless reuse is intentional and documented.
2. Deploy the reviewed program from a funded dedicated deployer to the
   intended mainnet RPC. Confirm program ID, executable state, upgrade
   authority, and bytecode/source verification before any app traffic.
3. Configure production variables in an isolated Railway environment. Run
   `npm run preflight:mainnet` **there**, not only on a developer laptop.
4. Release the matching app commit. Railway currently deploys the `main`
   branch on push, so inspect all existing uncommitted changes before merge.
5. Run a small canary from two fresh wallets. Confirm deposit, trading,
   settlement, each claim, and any refund on Solana and in the database.
6. Expand access gradually with alerting, a pause procedure, and a written
   rollback plan. A web rollback cannot undo an on-chain deployment or
   already accepted deposits; keep recovery and settlement available.

No mainnet transaction, Railway deployment, Git push, or live Panta order was
performed in this audit.
