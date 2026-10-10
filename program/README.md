# Oracle Rumble Escrow (Solana program)

Non-custodial escrow for an Oracle Rumble game. It holds real (devnet) USDC for
one hosted rumble: the shared **entry pool** plus every player's isolated
**trading vault**. Funds sit in a program-owned token account — the operator or
host can never move them to itself.

## Trust model

- The **host/operator** authorizes deposits and computes each player's
  entitlement from off-chain results. Players must trust that calculation:
  the program enforces conservation and complete accounting, but it cannot
  decide whether the ranking is fair.
- The host cannot transfer escrow directly to itself. It can settle the
  vault before the recovery deadline; after that, players claim their
  recorded entitlements. If it never closes settlement, players can recover
  their own deposit after the deadline.
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
| `Deposit` | player + operator | Transfer entry + vault into escrow; operator co-signature approves admission and opens a `PlayerEntry`. |
| `SettlePlayer` | host | Assign a player's entitlement (≤ remaining escrowed). |
| `CloseSettlement` | host | Prove every deposit is settled or recovered and all funds allocated, then unlock claims. |
| `Claim` | player | Withdraw the assigned entitlement, once. |
| `Recover` | player | After the deadline on an unsettled round, reclaim entry + vault. |

Current devnet program id: `Ea9pUaAdVwuR71L5xv6SYdryLXeTuMRUtEkMChaBUyUx`
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

## Mainnet deployment

The wallet in `PRIVATE_KEY` is configured locally as the escrow operator and
mainnet deployment payer/upgrade authority. Its local keypair file is
`.keys/mainnet-admin.json` (gitignored, mode 0600). The program ID still uses
its own keypair at `.keys/escrow-program-keypair.json`; that file initializes
the on-chain program address and does not pay deployment or runtime costs.

Do not deploy until the escrow has completed an independent security review,
the deployment wallet is funded, and a dedicated production RPC is available.
Then set `SOLANA_MAINNET_RPC` to that RPC and `MAINNET_AUDIT_APPROVED=YES`, and
run:

```bash
bash scripts/deploy-escrow-mainnet.sh
```

This initial-deploy script refuses public Solana RPC endpoints, non-mainnet
genesis hashes, missing audit approval, and program IDs that already exist on
mainnet. After deployment, set `NEXT_PUBLIC_ESCROW_PROGRAM_ID` to the reported
program ID and run the release preflight in the intended Railway environment.

When both env vars are set, `lib/escrow.ts` reports `ESCROW_ACTIVE = true` and
the app moves real USDC; otherwise it runs in ledger mode (server-side
accounting only) so the game is always playable.

> **Status note:** the current source builds to SBF locally, but the new
> admission and close checks have not been deployed or tested end-to-end on
> devnet. The program is not independently audited for real-funds use. See
> `MAINNET_READINESS.md` before any mainnet deployment.
