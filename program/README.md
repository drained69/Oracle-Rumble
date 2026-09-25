# Oracle Rumble Escrow (Solana program)

Non-custodial escrow for an Oracle Rumble game. It holds real (devnet) USDC for
one hosted rumble: the shared **entry pool** plus every player's isolated
**trading vault**. Funds sit in a program-owned token account — the operator or
host can never move them to itself.

## Trust model

- The **host** is trusted only to compute the **rankings** (who won), because
  ranking depends on off-chain price history from the round.
- The host is **not** trusted with custody. It cannot withdraw funds, cannot
  assign more entitlements than were actually escrowed (conservation is
  enforced), and cannot stop a player recovering after the deadline.
- Every payout goes to a **player's own wallet**. USDC leaves the escrow only
  via `Claim` (settled entitlement) or `Recover` (entry + vault, after the
  deadline, if the host never settles).

## Accounts

- `RoundVault` PDA — `["round", host, round_seed]`. Round config + running
  totals (pool, escrowed, settled, claimed) + status.
- Vault authority PDA — `["auth", round_vault]`. Owns the escrow token account
  and signs payouts.
- Escrow token account — the ATA of the vault authority for the USDC mint.
- `PlayerEntry` PDA — `["player", round_vault, wallet]`. One seat per wallet:
  vault deposit, assigned entitlement, settled/claimed flags.

## Instructions

| Ix | Who | Effect |
|----|-----|--------|
| `InitRound` | host | Create the vault + escrow token account; set entry/vault/capacity/deadline. |
| `Deposit` | player | Transfer entry + vault into escrow; open a `PlayerEntry`. |
| `SettlePlayer` | host | Assign a player's entitlement (≤ remaining escrowed). |
| `CloseSettlement` | host | Lock settlement so players can claim. |
| `Claim` | player | Withdraw the assigned entitlement, once. |
| `Recover` | player | After the deadline on an unsettled round, reclaim entry + vault. |

Program id: `Ea9pUaAdVwuR71L5xv6SYdryLXeTuMRUtEkMChaBUyUx`
(keypair: `.keys/escrow-program-keypair.json`, gitignored).

## Build & deploy (devnet)

```bash
# toolchain: solana-cli + cargo-build-sbf on PATH
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# 1. build
cd program && cargo-build-sbf            # → target/deploy/oracle_rumble_escrow.so

# 2. fund the deployer (~3 devnet SOL). If `solana airdrop 2` is rate-limited,
#    use https://faucet.solana.com for the address printed by `solana address`.

# 3. deploy
bash scripts/deploy-escrow.sh

# 4. set env (Railway + .env.local), then redeploy the web app:
#    NEXT_PUBLIC_ESCROW_PROGRAM_ID=Ea9pUaAdVwuR71L5xv6SYdryLXeTuMRUtEkMChaBUyUx
#    NEXT_PUBLIC_USDC_MINT=<the USDC mint Panta uses on devnet>
```

When both env vars are set, `lib/escrow.ts` reports `ESCROW_ACTIVE = true` and
the app moves real USDC; otherwise it runs in ledger mode (server-side
accounting only) so the game is always playable.

> **Status note:** in the build environment used to author this, the SBF
> platform-tools download and the devnet faucet were both network-blocked, so
> the `.so` had not yet been produced or deployed. The program compiles against
> `cargo-build-sbf` once the toolchain finishes downloading; nothing in the
> source depends on that environment.
