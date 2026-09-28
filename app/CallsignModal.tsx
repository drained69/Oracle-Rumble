"use client";

import { useState } from "react";
import { USERNAME_MAX, validateUsername } from "@/lib/username";

/** Standalone callsign editor used by the header on every page. */
export default function CallsignModal({
  initial,
  onSave,
  onClose
}: {
  initial: string;
  onSave: (value: string) => { ok: boolean; message: string };
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const v = validateUsername(draft);
  const hint = draft.length === 0
    ? "3–16 characters: letters, numbers and underscores."
    : v.ok ? "Available — shown on the arena stage, standings and results." : v.reason;
  const state = draft.length === 0 ? "" : v.ok ? "ok" : "bad";

  const submit = () => {
    const r = onSave(draft);
    if (r.ok) onClose();
    else setError(r.message);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cs-title" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Close">×</button>
        <h2 id="cs-title">{initial ? "Edit callsign" : "Choose your callsign"}</h2>
        <p className="sub">Your public name in every arena. Saved on this device for this wallet.</p>
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label>
            Callsign
            <input
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setError(""); }}
              placeholder="e.g. nova_9"
              maxLength={USERNAME_MAX}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              aria-invalid={state === "bad"}
              aria-describedby="cs-hint"
            />
          </label>
          <p id="cs-hint" className={`callsign-hint ${error ? "bad" : state}`} role="status">
            {error || hint}
          </p>
          <button type="submit" className="btn primary full" disabled={!v.ok} style={{ marginTop: 10 }}>
            Save callsign
          </button>
        </form>
      </div>
    </div>
  );
}
