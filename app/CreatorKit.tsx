"use client";

/**
 * CreatorKit — the host's tools for running a pit in front of an audience:
 * a big join code and QR to put on stream, the invite link, and a browser-
 * source overlay URL (OBS / Streamlabs) that shows the pit live.
 */

import { useEffect, useState } from "react";

export default function CreatorKit({ code, onToast }: { code: string; onToast: (msg: string) => void }) {
  const [origin, setOrigin] = useState("");
  const [qr, setQr] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const invite = origin ? `${origin}/a/${code}` : "";
  const overlay = origin ? `${origin}/a/${code}/overlay` : "";

  useEffect(() => {
    if (!invite) return;
    let live = true;
    import("qrcode").then((Q) => Q.toString(invite, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#edf0f6", light: "#00000000" } }))
      .then((svg) => { if (live) setQr(svg); })
      .catch(() => { /* QR is a nicety; the code and link still work */ });
    return () => { live = false; };
  }, [invite]);

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); onToast(`${what} copied.`); }
    catch { onToast("Copy failed — select the text and copy it manually."); }
  };

  return (
    <section className="creator-kit" aria-label="Host tools">
      <div className="ck-head">
        <span className="ck-k">You&apos;re hosting</span>
        <h3>Bring your audience in</h3>
        <p>Show the code or QR on stream — anyone who scans it takes a seat in this pit.</p>
      </div>
      <div className="ck-body">
        <div className="ck-qr" role="img" aria-label={`QR code linking to ${invite}`}>
          {qr ? <span dangerouslySetInnerHTML={{ __html: qr }} /> : <span className="ck-qr-ph" />}
        </div>
        <div className="ck-main">
          <div className="ck-code" aria-label={`Pit code ${code.split("").join(" ")}`}>{code}</div>
          <div className="ck-row">
            <input readOnly value={invite} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
            <button className="btn secondary sm" onClick={() => copy(invite, "Invite link")}>Copy link</button>
          </div>
          <div className="ck-row">
            <input readOnly value={overlay} onFocus={(e) => e.currentTarget.select()} aria-label="Stream overlay URL" />
            <button className="btn secondary sm" onClick={() => copy(overlay, "Overlay URL")}>Copy overlay</button>
            <a className="btn ghost sm" href={overlay} target="_blank" rel="noopener noreferrer">Preview</a>
          </div>
          <p className="ck-fine">
            Overlay: add the URL as a <b>Browser Source</b> in OBS or Streamlabs at 1280×720. The background is transparent;
            add <code>?bg=solid</code> for a solid one. It updates live — odds, pool, the leaderboard and the bell.
          </p>
        </div>
      </div>
    </section>
  );
}
