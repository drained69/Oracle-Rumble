#!/usr/bin/env node
/**
 * Panta market seeder — batch-creates devnet markets from a curated list.
 *
 * Runs the real Panta market creation lifecycle for every entry in
 * `scripts/curated-markets.json`:
 *
 *   POST /markets/create/quote/   → creation fee + createId
 *   POST /markets/create/build/   → unsigned VersionedTransaction (base64)
 *   sign locally with your keypair
 *   sendRawTransaction to Solana devnet RPC
 *   POST /markets/register/       → Panta writes catalog metadata
 *
 * Usage:
 *
 *   PANTA_API_KEY=pk_test_… \
 *   NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com \
 *     node scripts/seed-markets.mjs
 *
 * Flags:
 *   --keypair <path>   defaults to $HOME/.config/solana/id.json
 *   --markets <path>   defaults to scripts/curated-markets.json
 *   --dry              runs quote+build but skips signing & registering
 *
 * Sandbox note:
 *   With a `pk_test_*` key, Panta returns a fixed sandbox fixture — every
 *   quote yields the same createId and every registration collapses onto
 *   the single TestMarket1111… pubkey. The seeder still walks the full
 *   pipeline so a swap to `pk_live_*` needs no code change.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";

// ─── args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return args[i + 1];
}
const dry = args.includes("--dry");
const keypairPath = flag("keypair", path.join(os.homedir(), ".config", "solana", "id.json"));
const marketsPath = flag("markets", path.join(process.cwd(), "scripts", "curated-markets.json"));

// ─── env ──────────────────────────────────────────────────────────────
const PANTA_API_KEY = process.env.PANTA_API_KEY;
const PANTA_BASE = process.env.PANTA_API_BASE || "https://live-api.panta.market/api/v1";
const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";
if (!PANTA_API_KEY) {
  console.error("✖ PANTA_API_KEY required — export it or add to your shell env.");
  process.exit(1);
}
if (!dry && !fs.existsSync(keypairPath)) {
  console.error(`✖ Keypair not found at ${keypairPath}. Pass --keypair /path/to/id.json (or --dry to skip signing).`);
  process.exit(1);
}
if (!fs.existsSync(marketsPath)) {
  console.error(`✖ Curated markets file not found at ${marketsPath}.`);
  process.exit(1);
}

// ─── helpers ──────────────────────────────────────────────────────────
async function panta(pathPart, init = {}) {
  const url = `${PANTA_BASE}${pathPart}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "X-Api-Key": PANTA_API_KEY,
      "content-type": "application/json",
      accept: "application/json",
      ...(init.headers ?? {})
    }
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`${pathPart} → ${res.status} ${typeof body === "string" ? body : JSON.stringify(body).slice(0, 240)}`);
  return body;
}

function b64ToBytes(b64) {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function isoToUnix(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) throw new Error(`unparseable date: ${iso}`);
  return Math.floor(t / 1000);
}

// ─── seed loop ────────────────────────────────────────────────────────
const keypair = dry
  ? Keypair.generate() // never signs, but we need a pubkey for /markets/create/quote/
  : Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8"))));
const wallet = keypair.publicKey.toBase58();
const markets = JSON.parse(fs.readFileSync(marketsPath, "utf8"));
const connection = new Connection(RPC_URL, "confirmed");

console.log(`◈ Panta market seeder`);
console.log(`  base    ${PANTA_BASE}`);
console.log(`  rpc     ${RPC_URL}`);
console.log(`  wallet  ${wallet}${dry ? " (ephemeral, dry-run only)" : ""}`);
console.log(`  file    ${marketsPath}`);
console.log(`  ${markets.length} market${markets.length === 1 ? "" : "s"} queued${dry ? " · DRY RUN" : ""}`);

let created = 0;
let failed = 0;

for (let i = 0; i < markets.length; i++) {
  const m = markets[i];
  const tag = `[${String(i + 1).padStart(2, "0")}/${markets.length}]`;
  console.log(`\n${tag} ${m.question}`);
  try {
    // Panta's category enum is fixed; anything outside it 400s.
    const category = m.category;

    const nowSec = Math.floor(Date.now() / 1000);
    const endTimeSec = isoToUnix(m.endTime);
    const resolutionTimeSec = endTimeSec + 7 * 86400; // 7-day resolution window

    // 1. Quote
    const q = await panta("/markets/create/quote/", {
      method: "POST",
      body: JSON.stringify({
        wallet,
        question: m.question,
        resolutionRule: m.resolutionRule,
        sourcesOfTruth: m.sourcesOfTruth,
        category,
        startTime: nowSec,
        endTime: endTimeSec,
        resolutionTime: resolutionTimeSec,
        imageUrl: m.imageUrl
      })
    });
    const feeUsdc = q.paymentUsdc ? (Number(q.paymentUsdc) / 1_000_000).toFixed(2) : "?";
    console.log(`   quote  fee=${feeUsdc} USDC · createId=${q.createId} · pda=${q.expectedEventPda}`);
    if (dry) continue;

    // 2. Build (may return an empty transaction in sandbox — skip signing then)
    const b = await panta("/markets/create/build/", {
      method: "POST",
      body: JSON.stringify({ createId: q.createId, wallet })
    });

    let signature;
    if (!b.transaction) {
      console.log(`   build  sandbox fixture (empty tx) — using sandbox signature`);
      signature = "sandboxSignature" + "1".repeat(43);
    } else {
      const tx = VersionedTransaction.deserialize(b64ToBytes(b.transaction));
      tx.sign([keypair]);
      signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      console.log(`   send   sig=${signature}`);

      const deadline = Date.now() + 45_000;
      let confirmed = false;
      while (Date.now() < deadline) {
        const s = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
        const v = s.value?.confirmationStatus;
        if (v === "confirmed" || v === "finalized") { confirmed = true; break; }
        if (s.value?.err) throw new Error("rpc rejected: " + JSON.stringify(s.value.err));
        await new Promise((r) => setTimeout(r, 1500));
      }
      console.log(`   ${confirmed ? "confirmed" : "still pending — Panta will attribute async"}`);
    }

    // 3. Register with Panta
    const reg = await panta("/markets/register/", {
      method: "POST",
      body: JSON.stringify({ createId: q.createId, signature })
    });
    console.log(`   register  marketId=${reg.marketId} status=${reg.status}`);

    created += 1;
  } catch (err) {
    failed += 1;
    console.error(`   ✖ failed: ${err.message}`);
  }
}

console.log(`\n${dry ? "◇ dry-run complete" : "◈ done"} · ${created} created · ${failed} failed`);
