#!/usr/bin/env node
// Read-only release check. Run in the exact environment that will host paid pits.
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import nextEnv from "@next/env";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());

const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const failures = [];

function check(name, ok, detail = "") {
  process.stdout.write(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}\n`);
  if (!ok) failures.push(name);
}

const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC ?? "";
const mint = process.env.NEXT_PUBLIC_USDC_MINT ?? "";
const program = process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID ?? "";
check("cluster", cluster === "mainnet-beta");
const httpsRpc = /^https:\/\//.test(rpc) && !/devnet|testnet/i.test(rpc);
const productionRpc = httpsRpc && !/api\.(mainnet|mainnet-beta)\.solana\.com/i.test(rpc);
check("private production RPC", productionRpc);
check("Circle mainnet USDC", mint === MAINNET_USDC);
check("persistent database", !!process.env.DATABASE_URL);
if (process.env.DATABASE_URL) {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await db.query("SELECT 1");
    check("database reachable", true);
  } catch {
    check("database reachable", false);
  } finally {
    await db.end().catch(() => {});
  }
}
check("live Panta key", /^pk_live_/.test(process.env.PANTA_API_KEY ?? ""));
check("Privy app ID and server secret", !!process.env.NEXT_PUBLIC_PRIVY_APP_ID && !!process.env.PRIVY_APP_SECRET);
const sessionSecret = process.env.SESSION_SECRET ?? "";
check("independent session secret", sessionSecret.length >= 32
  && sessionSecret !== process.env.ESCROW_HOST_SECRET_KEY
  && sessionSecret !== process.env.ROUND_HOST_SECRET);
let operator = null;
try { operator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.ESCROW_HOST_SECRET_KEY ?? ""))); }
catch { /* no secret material is printed */ }
check("escrow operator key", !!operator);
let programKey = null;
try { programKey = new PublicKey(program); } catch { /* invalid public key */ }
check("escrow program ID", !!programKey);

// A public RPC is insufficient for production, but still useful for finding
// missing mainnet accounts during staging. Do not skip those checks merely
// because the endpoint is public.
if (cluster === "mainnet-beta" && httpsRpc) {
  try {
    const conn = new Connection(rpc, "confirmed");
    const genesis = await conn.getGenesisHash();
    check("RPC genesis", genesis === MAINNET_GENESIS);
    if (mint === MAINNET_USDC) {
      const account = await conn.getAccountInfo(new PublicKey(mint), "confirmed");
      check("USDC mint account", !!account && account.owner.toBase58() === TOKEN_PROGRAM
        && account.data.length >= 82 && account.data[44] === 6 && account.data[45] === 1);
    }
    if (programKey) {
      const account = await conn.getAccountInfo(programKey, "confirmed");
      check("escrow program executable", !!account?.executable);
    }
    if (operator) {
      const balance = await conn.getBalance(operator.publicKey, "confirmed");
      check("operator funded", balance > 0);
    }
  } catch (err) {
    check("RPC access", false, err instanceof Error ? err.message : "unavailable");
  }
}

process.stdout.write(`\n${failures.length ? `${failures.length} release check(s) failed` : "Configuration checks passed"}.\n`);
process.exitCode = failures.length ? 1 : 0;
