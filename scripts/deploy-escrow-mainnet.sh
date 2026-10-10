#!/usr/bin/env bash
# Initial mainnet deployment only. The same admin wallet pays and retains
# upgrade authority, and is also configured as ESCROW_HOST_SECRET_KEY.
# The program-ID keypair is separate because Solana needs one to create the
# program address; it does not need to hold SOL.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RPC="${SOLANA_MAINNET_RPC:-}"
ADMIN_KEYPAIR="${MAINNET_ADMIN_KEYPAIR:-.keys/mainnet-admin.json}"
PROGRAM_KEYPAIR="${MAINNET_PROGRAM_KEYPAIR:-.keys/escrow-program-keypair.json}"
SO="program/target/deploy/oracle_rumble_escrow.so"
MAINNET_GENESIS="5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"

if [[ -z "$RPC" ]]; then
  echo "Set SOLANA_MAINNET_RPC to a dedicated production mainnet RPC." >&2
  exit 1
fi
if [[ "$RPC" != https://* || "$RPC" =~ (devnet|testnet|api\.mainnet\.solana\.com|api\.mainnet-beta\.solana\.com) ]]; then
  echo "Use a dedicated HTTPS mainnet RPC; public Solana endpoints are not accepted for deployment." >&2
  exit 1
fi
if [[ "${MAINNET_AUDIT_APPROVED:-}" != "YES" ]]; then
  echo "An independent security review must be complete before deployment. Set MAINNET_AUDIT_APPROVED=YES only after it is complete." >&2
  exit 1
fi
if [[ ! -f "$ADMIN_KEYPAIR" || ! -f "$PROGRAM_KEYPAIR" ]]; then
  echo "Missing admin or program-ID keypair. Keep both files private and gitignored." >&2
  exit 1
fi

export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

GENESIS="$(solana genesis-hash --url "$RPC")"
if [[ "$GENESIS" != "$MAINNET_GENESIS" ]]; then
  echo "RPC genesis hash is not Solana mainnet; refusing deployment." >&2
  exit 1
fi

ADMIN="$(solana address --keypair "$ADMIN_KEYPAIR")"
PROGRAM_ID="$(solana address --keypair "$PROGRAM_KEYPAIR")"
if [[ "$ADMIN" == "$PROGRAM_ID" ]]; then
  echo "Admin signer and program-ID keypair must be different." >&2
  exit 1
fi
if solana program show --url "$RPC" "$PROGRAM_ID" >/dev/null 2>&1; then
  echo "Program ID already exists on mainnet. Refusing initial deploy; use a reviewed upgrade procedure." >&2
  exit 1
fi

echo "Building escrow program from the current source..."
(cd program && cargo-build-sbf)

echo "Mainnet admin/payer/upgrade authority: $ADMIN"
echo "New program ID: $PROGRAM_ID"
echo "Admin balance: $(solana balance --url "$RPC" --keypair "$ADMIN_KEYPAIR")"
echo "Program bytecode SHA-256: $(shasum -a 256 "$SO" | awk '{print $1}')"
echo "Deploying reviewed bytecode..."
solana program deploy "$SO" \
  --url "$RPC" \
  --keypair "$ADMIN_KEYPAIR" \
  --program-id "$PROGRAM_KEYPAIR" \
  --upgrade-authority "$ADMIN_KEYPAIR" \
  --use-rpc

echo "Verify executable program and record this program ID: $PROGRAM_ID"
