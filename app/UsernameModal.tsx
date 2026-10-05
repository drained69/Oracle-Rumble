"use client";

import { useState } from "react";
import { USERNAME_MAX, validateUsername } from "@/lib/username";
import { useEscapeKey } from "@/lib/use-escape";
import { useWalletIdentity } from "@/lib/use-wallet";

/** "Set username" dialog, opened from the header on every page. */
export default function UsernameModal({
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
  const [busy, setBusy] = useState(false);
  const { xRequired, connectX } = useWalletIdentity();
  useEscapeKey(true, onClose);

  // Usernames are X handles on this deployment: connect X instead of typing one.
  if (xRequired) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="un-title" onClick={(e) => e.stopPropagation()}>
          <button className="close" onClick={onClose} aria-label="Close">×</button>
          <h2 id="un-title">Your username</h2>
          {initial ? (
            <p className="sub">You play as <b>@{initial}</b>, your X handle. Usernames come from X and are set once, so it can&apos;t be changed.</p>
          ) : (
            <>
              <p className="sub">Your username is your X handle. Connect X once and it&apos;s set for good — every arena, standing and result shows it. You&apos;ll come straight back here.</p>
              <button
                type="button"
                className="btn primary full x-connect"
                disabled={busy}
                onClick={async () => {
                  setBusy(true); setError("");
                  const r = await connectX();
                  if (!r.ok) { setError(r.message); setBusy(false); }
                }}
              >
                {busy ? "Opening X…" : "Connect X"}
              </button>
              {error && <p className="username-hint bad" role="alert">{error}</p>}
            </>
          )}
        </div>
      </div>
    );
  }
  const v = validateUsername(draft);
  const hint = draft.length === 0
    ? "3–16 characters: letters, numbers and underscores."
    : v.ok ? "Looks good — this is how other players will see you." : v.reason;
  const state = draft.length === 0 ? "" : v.ok ? "ok" : "bad";

  const submit = () => {
    const r = onSave(draft);
    if (r.ok) onClose();
    else setError(r.message);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="un-title" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Close">×</button>
        <h2 id="un-title">{initial ? "Edit username" : "Set username"}</h2>
        <p className="sub">Shown on the arena stage, standings and results. Saved on this device for your wallet — change it any time before you join an arena.</p>
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label>
            Username
            <input
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setError(""); }}
              placeholder="e.g. nova_9"
              maxLength={USERNAME_MAX}
              autoFocus
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-invalid={state === "bad"}
              aria-describedby="un-hint"
            />
          </label>
          <p id="un-hint" className={`username-hint ${error ? "bad" : state}`} role="status">
            {error || hint}
          </p>
          {draft.length > 0 && v.ok && (
            <div className="username-preview" aria-hidden="true">
              <span>Preview</span>
              <b>{v.value}</b>
            </div>
          )}
          <button type="submit" className="btn primary full" disabled={!v.ok} style={{ marginTop: 10 }}>
            {initial ? "Save username" : "Set username"}
          </button>
        </form>
      </div>
    </div>
  );
}
