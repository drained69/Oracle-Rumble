import QRCode from "qrcode";
import React, { useMemo } from "react";
import { F } from "../../fonts";
import { C, rgba } from "../../theme";
import { PIT } from "../../timeline";
import { BrandMark } from "../brand";
import { Touch, pressScale } from "../kit";

/** Scans to the live site (a fictional pit code would lead nowhere). */
export const QR_TARGET = "https://www.trythepit.xyz";

export const QR: React.FC<{ size: number; dark?: string; light?: string; reveal?: number }> = ({ size, dark = C.text, light = "transparent", reveal = 1 }) => {
  const { n, path } = useMemo(() => {
    const q = QRCode.create(QR_TARGET, { errorCorrectionLevel: "M" });
    const n = q.modules.size;
    let d = "";
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.modules.data[y * n + x]) d += `M${x + 1} ${y + 1}h1v1h-1z`;
    return { n, path: d };
  }, []);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${n + 2} ${n + 2}`} style={{ display: "block", shapeRendering: "crispEdges" }}>
      <rect width={n + 2} height={n + 2} fill={light} />
      <clipPath id={`qr-clip-${size}`}><rect x="0" y="0" width={n + 2} height={(n + 2) * reveal} /></clipPath>
      <path d={path} fill={dark} clipPath={`url(#qr-clip-${size})`} />
    </svg>
  );
};

/** app/CreatorKit.tsx — the host's stream tools. */
export const CreatorKit: React.FC<{ m: boolean; beat: number; copyAt: number; copied: number; qrReveal: number }> = ({ m, beat, copyAt, copied, qrReveal }) => {
  const code = PIT.hostedCode;
  const invite = `trythepit.xyz/a/${code}`;
  const overlay = `trythepit.xyz/a/${code}/overlay`;
  const field = (v: string, hl: boolean) => (
    <div style={{
      flex: 1, minWidth: 0, height: m ? 34 : 36, borderRadius: 8, padding: "0 10px", display: "flex", alignItems: "center", fontFamily: F.mono, fontSize: m ? 10.5 : 12,
      color: hl ? C.text : C.text2, background: "rgba(10,13,19,0.8)", border: `1px solid ${hl ? rgba(C.plasma, 0.6) : C.borderStrong}`, whiteSpace: "nowrap", overflow: "hidden"
    }}>{v}</div>
  );
  const btn = (label: string, pressed?: number, tone?: boolean) => (
    <div style={{
      position: "relative", height: m ? 34 : 36, padding: m ? "0 10px" : "0 13px", borderRadius: 8, display: "flex", alignItems: "center", fontFamily: F.text, fontWeight: 700,
      fontSize: m ? 11.5 : 12.5, color: tone ? "#051018" : C.text, whiteSpace: "nowrap",
      background: tone ? `linear-gradient(180deg, ${C.plasma}, #0891b2)` : C.surfaceAlt, border: tone ? "none" : `1px solid ${C.borderStrong}`,
      transform: pressed !== undefined ? `scale(${pressScale(beat, pressed)})` : undefined
    }}>
      {label}
      {pressed !== undefined && <Touch beat={beat} at={pressed} />}
    </div>
  );
  return (
    <div style={{
      borderRadius: 16, padding: m ? 14 : 20, display: "flex", flexDirection: "column", gap: m ? 12 : 16,
      background: "radial-gradient(500px 200px at 0% 0%, rgba(192,132,252,0.14), transparent 70%), linear-gradient(180deg, rgba(19,24,36,0.96), rgba(13,16,23,0.96))",
      border: `1px solid ${rgba(C.neon, 0.4)}`
    }}>
      <div>
        <div style={{ fontFamily: F.mono, fontWeight: 700, fontSize: m ? 10 : 11, letterSpacing: 1.6, textTransform: "uppercase", color: C.neon }}>You&apos;re hosting</div>
        <div style={{ fontFamily: F.display, fontWeight: 900, fontSize: m ? 19 : 24, color: C.text, textTransform: "uppercase", marginTop: 4 }}>Bring your audience in</div>
        <div style={{ fontFamily: F.text, fontSize: m ? 11.5 : 13, lineHeight: 1.45, color: C.text2, marginTop: 4 }}>
          Show the code or QR on stream — anyone who scans it takes a seat in this pit.
        </div>
      </div>
      <div style={{ display: "flex", gap: m ? 12 : 18, alignItems: m ? "flex-start" : "center" }}>
        <div style={{ padding: 8, borderRadius: 12, background: "rgba(10,13,19,0.8)", border: `1px solid ${C.borderStrong}`, flexShrink: 0 }}>
          <QR size={m ? 104 : 150} reveal={qrReveal} />
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: m ? 8 : 10 }}>
          <div style={{
            fontFamily: F.display, fontWeight: 900, fontSize: m ? 30 : 46, letterSpacing: m ? 4 : 8, color: C.text,
            textShadow: `0 0 26px ${rgba(C.neon, 0.5)}`, lineHeight: 1
          }}>{code}</div>
          {!m && <div style={{ display: "flex", gap: 8 }}>{field(invite, false)}{btn("Copy link")}</div>}
          <div style={{ display: "flex", gap: 8 }}>{field(overlay, copied > 0)}{btn("Copy overlay", copyAt, true)}</div>
        </div>
      </div>
      {m && <div style={{ display: "flex", gap: 8 }}>{field(invite, false)}{btn("Copy link")}</div>}
      <div style={{ fontFamily: F.text, fontSize: m ? 10.5 : 12, lineHeight: 1.5, color: C.text3 }}>
        Overlay: add the URL as a <b style={{ color: C.text2 }}>Browser Source</b> in OBS or Streamlabs at 1280×720. The background is transparent{m ? "." : "; add ?bg=solid for a solid one."} It updates live — odds, pool, the leaderboard and the bell.
      </div>
    </div>
  );
};

/** app/PitOverlay.tsx — the transparent browser-source card for a stream. */
export const PitOverlayCard: React.FC<{ yes: number; spark: number[]; clockText: string; scale?: number; status?: string }> = ({ yes, spark, clockText, scale = 1, status = "Live" }) => {
  const y = Math.round(yes);
  const top = [
    ["pit_rookie", "YES", 11.62], ["vault_vera", "YES", 10.94], ["moonmira", "YES", 10.41], ["kai_calls", "NO", 9.78], ["yes_yuki", "YES", 9.55]
  ] as const;
  const t0 = spark.length;
  const path = spark.map((v, i) => `${i ? "L" : "M"}${((i / Math.max(1, t0 - 1)) * 300).toFixed(1)},${(60 - ((v - 40) / 40) * 60).toFixed(1)}`).join("");
  return (
    <div style={{
      width: 520, transform: `scale(${scale})`, transformOrigin: "top left", borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 12,
      background: "rgba(11,14,23,0.86)", border: `1px solid ${rgba(C.neon, 0.4)}`, boxShadow: "0 16px 40px rgba(0,0,0,0.5)", backdropFilter: "blur(6px)"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: F.display, fontWeight: 900, fontSize: 13, letterSpacing: 2.4, color: C.text }}>
          <BrandMark size={26} id="ov" /> THE PIT
        </span>
        <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 11, letterSpacing: 1.2, color: C.neon, padding: "3px 8px", borderRadius: 6, border: `1px solid ${rgba(C.neon, 0.4)}` }}>PIT {PIT.hostedCode}</span>
        <span style={{ marginLeft: "auto", fontFamily: F.mono, fontWeight: 700, fontSize: 11, color: C.plasma, padding: "3px 8px", borderRadius: 6, background: rgba(C.plasma, 0.12) }}>{status} · {clockText}</span>
      </div>
      <div style={{ fontFamily: F.text, fontWeight: 700, fontSize: 17, color: C.text }}>{PIT.hostedQuestion}</div>
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", height: 30, borderRadius: 9, overflow: "hidden", fontFamily: F.mono, fontWeight: 800, fontSize: 13 }}>
          <span style={{ width: `${y}%`, background: `linear-gradient(90deg, #0891b2, ${C.plasma})`, display: "flex", alignItems: "center", paddingLeft: 10, color: "#051018" }}>YES {y}¢</span>
          <span style={{ flex: 1, background: `linear-gradient(90deg, #be123c, ${C.down})`, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 10, color: "#fff" }}>NO {100 - y}¢</span>
        </div>
        <svg viewBox="0 0 300 60" preserveAspectRatio="none" style={{ width: "100%", height: 46, display: "block", marginTop: 6 }}>
          <path d={path} fill="none" stroke={C.series} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
        <div style={{ fontFamily: F.mono, fontSize: 11, color: C.text2 }}>Panta line {PIT.line}¢ · room {y - PIT.line >= 0 ? "+" : "−"}{Math.abs(y - PIT.line)}¢</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 130px", gap: 12 }}>
        <div>
          <div style={{ fontFamily: F.mono, fontSize: 10, fontWeight: 700, letterSpacing: 1.3, textTransform: "uppercase", color: C.text3, marginBottom: 5 }}>Top of the pit · 8 in</div>
          {top.map(([n, s, v], i) => (
            <div key={n} style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: F.text, fontSize: 12.5, color: C.text, padding: "3px 0" }}>
              <span style={{ width: 22, fontFamily: F.display, fontWeight: 800, fontSize: 10.5, color: C.neon }}>#{i + 1}</span>
              <span style={{ flex: 1 }}>{n}</span>
              <span style={{ fontFamily: F.mono, fontSize: 10, fontWeight: 700, color: s === "YES" ? C.plasma : C.down }}>{s}</span>
              <span style={{ fontFamily: F.mono, fontWeight: 700, width: 56, textAlign: "right" }}>${v.toFixed(2)}</span>
            </div>
          ))}
        </div>
        <div style={{ borderRadius: 12, padding: 10, background: "rgba(19,24,36,0.7)", border: `1px solid ${C.border}` }}>
          <div style={{ fontFamily: F.mono, fontSize: 10, fontWeight: 700, letterSpacing: 1.3, textTransform: "uppercase", color: C.text3 }}>Pool</div>
          <div style={{ fontFamily: F.display, fontWeight: 900, fontSize: 26, color: C.plasma, textShadow: `0 0 14px ${rgba(C.plasma, 0.4)}` }}>$16.00</div>
        </div>
      </div>
    </div>
  );
};
