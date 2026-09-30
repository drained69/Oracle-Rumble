"use client";

import { OPENING_CALL_SIZES } from "@/lib/royale";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** How much of the vault an opening call uses: 25%, half or all of it. */
export default function CallSizePicker({
  value, onChange, vault, disabled
}: { value: number; onChange: (pct: number) => void; vault: number; disabled?: boolean }) {
  return (
    <div className="call-size" role="radiogroup" aria-label="How much of your vault goes on the call">
      <span className="call-size-k">On the call</span>
      <div className="call-size-opts">
        {OPENING_CALL_SIZES.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={value === p}
            className={`call-size-opt ${value === p ? "on" : ""}`}
            onClick={() => onChange(p)}
            disabled={disabled}
          >
            {p === 100 ? "All" : p === 50 ? "Half" : `${p}%`}
            <em>{usd.format((vault * p) / 100)}</em>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Sentence describing what the call does at this size. */
export function callSizeText(pct: number, vault: number): { stake: string; rest: string | null } {
  const stake = (vault * pct) / 100;
  return {
    stake: pct >= 100 ? `your whole ${usd.format(vault)} vault` : `${usd.format(stake)} of your ${usd.format(vault)} vault`,
    rest: pct >= 100 ? null : `The other ${usd.format(vault - stake)} stays in cash for trades and parlays.`
  };
}
