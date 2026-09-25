#!/usr/bin/env bash
#
# Deploy the Oracle Rumble escrow program to Solana devnet.
#
# Prereqs:
#   - Solana toolchain installed (solana, cargo-build-sbf on PATH)
#   - The deployer keypair (~/.config/solana/id.json) funded with ~3 devnet SOL.
#     If `solana airdrop` is rate-limited, fund it at https://faucet.solana.com
#     (paste the address printed below) or transfer from another devnet wallet.
#
# Usage:  bash scripts/deploy-escrow.sh
set -euo pipefail

export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "$0")/.."

CLUSTER_URL="${SOLANA_URL:-https://api.devnet.solana.com}"
PROGRAM_KEYPAIR=".keys/escrow-program-keypair.json"
SO="program/target/deploy/oracle_rumble_escrow.so"

solana config set --url "$CLUSTER_URL" >/dev/null

if [[ ! -f "$SO" ]]; then
  echo "Building program (cargo-build-sbf)…"
  ( cd program && cargo-build-sbf )
fi

PROGRAM_ID="$(solana address -k "$PROGRAM_KEYPAIR")"
DEPLOYER="$(solana address)"
BALANCE="$(solana balance || echo '0 SOL')"

echo "Cluster : $CLUSTER_URL"
echo "Deployer: $DEPLOYER   ($BALANCE)"
echo "Program : $PROGRAM_ID"
echo

if [[ "$BALANCE" == "0 SOL" ]]; then
  echo "Deployer has no SOL. Fund $DEPLOYER at https://faucet.solana.com then re-run." >&2
  exit 1
fi

solana program deploy "$SO" --program-id "$PROGRAM_KEYPAIR"

echo
echo "Deployed. Add to your environment (Railway + .env.local):"
echo "  NEXT_PUBLIC_ESCROW_PROGRAM_ID=$PROGRAM_ID"
echo "  NEXT_PUBLIC_USDC_MINT=<the USDC mint Panta uses on devnet>"
