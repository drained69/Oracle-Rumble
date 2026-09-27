"use client";

/**
 * PantaOrderStatus — inline lifecycle tracker for a real Panta order.
 *
 * Renders the current step of the /orders/quote → build → sign → submit
 * → verify → report chain, plus a scrolling one-line note. Attaches
 * under the trade summary in ArenaView when "Fill on Panta" is on.
 */

import type { LifecycleUpdate, LifecycleStep } from "@/lib/panta-order";

const ORDER: LifecycleStep[] = [
  "quoting",
  "building",
  "signing",
  "broadcasting",
  "confirming",
  "reporting",
  "attributed"
];

const LABELS: Record<LifecycleStep, string> = {
  idle: "Idle",
  quoting: "Quote",
  quoted: "Quote",
  building: "Build",
  built: "Build",
  signing: "Sign",
  broadcasting: "Broadcast",
  confirming: "Confirm",
  confirmed: "Confirm",
  reporting: "Attribute",
  attributed: "Attribute",
  done: "Done",
  error: "Error"
};

function stepIndex(step: LifecycleStep): number {
  // Collapse the "-ed" states onto their "-ing" step for the progress bar.
  const key: LifecycleStep = (step === "quoted" ? "quoting"
    : step === "built" ? "building"
    : step === "confirmed" ? "confirming"
    : step === "attributed" ? "reporting"
    : step);
  return ORDER.indexOf(key);
}

export default function PantaOrderStatus({ update }: { update: LifecycleUpdate | null }) {
  const step = update?.step ?? "idle";
  const err = step === "error";
  const done = step === "done" || step === "attributed";
  const currentIdx = err ? -1 : stepIndex(step);
  const explorer = update?.signature && update.signature.length > 20
    ? `https://explorer.solana.com/tx/${update.signature}${(process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet") === "mainnet-beta" ? "" : `?cluster=${process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet"}`}`
    : null;

  return (
    <div className={`panta-order ${err ? "err" : done ? "done" : "live"}`}>
      <div className="panta-order-head">
        <span className="eyebrow">Panta order lifecycle</span>
        {update?.source && <span className={`src ${update.source}`}>{update.source === "panta" ? "LIVE" : "DEMO"}</span>}
      </div>
      <ol className="panta-order-steps">
        {ORDER.map((s, i) => {
          const state = err ? (i <= currentIdx ? "done" : "pending")
            : done ? "done"
            : (i < currentIdx ? "done" : i === currentIdx ? "active" : "pending");
          return (
            <li key={s} className={state}>
              <span className="dot" />
              <span className="lab">{LABELS[s]}</span>
            </li>
          );
        })}
      </ol>
      <div className="panta-order-note">
        {err ? <span className="err">✕ {update?.error ?? "failed"}</span>
          : <span>{update?.note ?? "waiting for buy…"}</span>}
      </div>
      {explorer && (
        <a className="panta-order-sig" href={explorer} target="_blank" rel="noopener noreferrer">
          {update!.signature!.slice(0, 8)}…{update!.signature!.slice(-4)} ↗
        </a>
      )}
    </div>
  );
}
