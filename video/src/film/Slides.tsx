import React from "react";
import { clamp, easeOutBack, easeOutCubic, easeOutQuint, hash01, prog } from "../anim";
import { F } from "../fonts";
import { C, rgba } from "../theme";
import { PLAYERS, at, cueBeat, section, type SectionId } from "../timeline";
import { Avatar, BrandMark, Wordmark, XLogo } from "../ui/brand";
import { beatPulse } from "./Backdrop";

// ── shared pieces ─────────────────────────────────────────────────────

/** In/out envelope for a slide that fills its section. */
export function slideP(beat: number, id: SectionId, inDur = 0.7, outDur = 0.6) {
  const s = section(id);
  const inP = prog(beat, s.startBeat - 0.45, inDur, easeOutQuint);
  const outP = prog(beat, s.endBeat - outDur, outDur, (t) => t * t);
  return { inP, outP, on: beat >= s.startBeat - 0.5 && beat <= s.endBeat + 0.05 };
}

const Chapter: React.FC<{ label: string; p: number }> = ({ label, p }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 16, opacity: p, transform: `translateX(${(1 - p) * -30}px)` }}>
    <span style={{ width: 46 * p, height: 4, borderRadius: 2, background: `linear-gradient(90deg, ${C.neon}, ${C.plasma})` }} />
    <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 24, letterSpacing: 6, color: C.plasma, textTransform: "uppercase" }}>{label}</span>
  </div>
);

const Headline: React.FC<{ text: React.ReactNode; p: number; size?: number }> = ({ text, p, size = 64 }) => (
  <div style={{
    fontFamily: F.text, fontWeight: 800, fontSize: size, lineHeight: 1.05, letterSpacing: -size * 0.035, color: C.text,
    opacity: clamp(p * 1.4), transform: `translateY(${(1 - p) * 30}px)`
  }}>{text}</div>
);

const Glass: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; glow?: number; tone?: string }> = ({ children, style, glow = 0, tone = C.neon }) => (
  <div style={{
    position: "relative", borderRadius: 24, background: "linear-gradient(180deg, rgba(23,29,44,0.94), rgba(12,15,22,0.94))",
    border: `1px solid ${rgba(tone, 0.22 + glow * 0.45)}`,
    boxShadow: `0 30px 80px rgba(0,0,0,0.5), 0 0 ${60 * glow}px ${rgba(tone, 0.25 * glow)}`, ...style
  }}>{children}</div>
);

const Frame: React.FC<{ children: React.ReactNode; inP: number; outP: number; beat: number; id: SectionId }> = ({ children, inP, outP, beat, id }) => {
  const s = section(id);
  const drift = 1 + 0.025 * clamp((beat - s.startBeat) / (s.endBeat - s.startBeat));
  return (
    <div style={{ position: "absolute", inset: 0, opacity: inP * (1 - outP), transform: `scale(${drift * (0.97 + 0.03 * inP) * (1 + 0.04 * outP)})`, filter: outP > 0 ? `blur(${outP * 6}px)` : undefined }}>
      {children}
    </div>
  );
};

/** Pop-in for cards keyed to a cue. */
const pop = (beat: number, at: number) => prog(beat, at, 0.55, (t) => easeOutBack(t, 1.3));

// ── The problem ───────────────────────────────────────────────────────

const LonelyTicket: React.FC<{ beat: number }> = ({ beat }) => {
  const pts = Array.from({ length: 40 }, (_, i) => 60 + Math.sin(i * 0.45 + beat * 0.08) * 8 + Math.sin(i * 1.7) * 3);
  const path = pts.map((v, i) => `${i ? "L" : "M"}${(i / 39) * 220},${v}`).join("");
  return (
    <div style={{ display: "flex", gap: 14, height: 220, filter: "grayscale(1)", opacity: 0.85 }}>
      <div style={{ flex: 1, borderRadius: 14, background: "#0f131b", border: `1px solid ${C.borderStrong}`, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.mono, fontSize: 13, color: C.text3 }}><span>YES · 0.62</span><span>● 1 online</span></div>
        <svg width="100%" height="120" viewBox="0 0 220 120" preserveAspectRatio="none"><path d={path} fill="none" stroke="#6b7280" strokeWidth="2" /></svg>
        <div style={{ display: "flex", gap: 8 }}>
          {["Buy", "Sell"].map((b) => <span key={b} style={{ flex: 1, textAlign: "center", padding: "8px 0", borderRadius: 8, background: "#1a2030", fontFamily: F.text, fontWeight: 700, fontSize: 14, color: C.text3 }}>{b}</span>)}
        </div>
      </div>
      <div style={{ width: 150, borderRadius: 14, background: "#0f131b", border: `1px solid ${C.borderStrong}`, padding: "12px 12px", display: "flex", flexDirection: "column", gap: 5, fontFamily: F.mono, fontSize: 13 }}>
        {[0.66, 0.65, 0.64, 0.63].map((p) => <div key={p} style={{ display: "flex", justifyContent: "space-between", color: "#8b8f99" }}><span>{p.toFixed(2)}</span><span>{Math.round(200 + hash01(p * 99) * 900)}</span></div>)}
        <div style={{ height: 1, background: C.border, margin: "3px 0" }} />
        {[0.61, 0.6, 0.59, 0.58].map((p) => <div key={p} style={{ display: "flex", justifyContent: "space-between", color: "#6b7280" }}><span>{p.toFixed(2)}</span><span>{Math.round(200 + hash01(p * 77) * 900)}</span></div>)}
      </div>
    </div>
  );
};

const ChatPoll: React.FC<{ beat: number; from: number }> = ({ beat, from }) => {
  const msgs = [["night_owl", "YES easy, calling it now"], ["0xmango", "no shot it hits"], ["sol_sam", "YES or I'm logging off"], ["chartgoblin", "NO. screenshot this"], ["degen_dee", "YES YES YES"], ["quiet_kev", "who's actually betting?"]];
  const k = Math.max(0, (beat - from) * 1.6);
  const count = Math.min(msgs.length, Math.floor(k) + 1);
  return (
    <div style={{ height: 220, display: "flex", gap: 14 }}>
      <div style={{ flex: 1, borderRadius: 14, background: "#0f131b", border: `1px solid ${C.borderStrong}`, padding: 12, overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", left: 12, right: 12, bottom: 10, display: "flex", flexDirection: "column", gap: 7 }}>
          {msgs.map(([u, t], i) => {
            const shown = clamp(k - i);
            return (
              <div key={u} style={{ opacity: shown, transform: `translateY(${(1 - shown) * 14}px)`, fontFamily: F.text, fontSize: 14, color: C.text, display: i < count - 5 || i >= count ? "none" : "block" }}>
                <b style={{ color: [C.neon, C.plasma, C.gold, C.xp, C.up, C.text2][i] }}>{u}</b> {t}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ width: 190, borderRadius: 14, background: "#0f131b", border: `1px solid ${C.borderStrong}`, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ fontFamily: F.text, fontWeight: 700, fontSize: 14, color: C.text }}>Poll: will it happen?</span>
        {[["YES", 61, C.plasma], ["NO", 39, C.down]].map(([l, v, c]) => (
          <div key={l as string} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.mono, fontSize: 13, color: C.text2 }}><span>{l}</span><span>{v}%</span></div>
            <div style={{ height: 8, borderRadius: 5, background: "#1a2030" }}><div style={{ width: `${(v as number) * clamp((beat - from) / 2)}%`, height: "100%", borderRadius: 5, background: c as string }} /></div>
          </div>
        ))}
        <span style={{ marginTop: "auto", alignSelf: "flex-start", fontFamily: F.mono, fontWeight: 800, fontSize: 14, color: C.down, padding: "5px 10px", borderRadius: 8, background: rgba(C.down, 0.12), border: `1px solid ${rgba(C.down, 0.45)}` }}>$0 at stake</span>
      </div>
    </div>
  );
};

const SeedWall: React.FC<{ beat: number; from: number }> = ({ beat, from }) => (
  <div style={{ height: 220, display: "flex", gap: 14 }}>
    <div style={{ flex: 1, borderRadius: 14, background: "#0f131b", border: `1px solid ${C.borderStrong}`, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontFamily: F.text, fontWeight: 700, fontSize: 13, color: C.text2 }}>Write down your 12 words</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} style={{ fontFamily: F.mono, fontSize: 12, color: C.text3, padding: "5px 6px", borderRadius: 6, background: "#1a2030", opacity: clamp((beat - from) * 3 - i * 0.25) }}>{i + 1}. ••••••</span>
        ))}
      </div>
      <span style={{ marginTop: "auto", alignSelf: "flex-start", fontFamily: F.text, fontWeight: 700, fontSize: 13, color: C.text2, padding: "6px 10px", borderRadius: 8, border: `1px dashed ${C.borderStrong}` }}>+ Install wallet extension</span>
    </div>
    <div style={{ width: 170, borderRadius: 14, background: "#0f131b", border: `1px solid ${C.borderStrong}`, padding: 14, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, justifyContent: "center" }}>
      <svg width="72" height="72" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="15" rx="3" fill="none" stroke="#8b93a7" strokeWidth="1.6" /><circle cx="12" cy="12.5" r="3.2" fill="none" stroke="#8b93a7" strokeWidth="1.6" /><path d="M12 9.3v-1M12 16.7v-1M8.8 12.5h-1M16.2 12.5h-1" stroke="#8b93a7" strokeWidth="1.4" /></svg>
      <span style={{ fontFamily: F.text, fontSize: 13, color: C.text2, textAlign: "center", lineHeight: 1.3 }}>Pot held by<br /><b style={{ color: C.xp }}>someone else</b></span>
    </div>
  </div>
);

export const ProblemSlide: React.FC<{ beat: number }> = ({ beat }) => {
  const { inP, outP, on } = slideP(beat, "problem");
  if (!on) return null;
  const s = at("problem");
  const cards = [
    { at: cueBeat("problem.card1"), title: "A solo sport", line: "You, a chart and an order book. No room, no rivals.", art: <LonelyTicket beat={beat} /> },
    { at: cueBeat("problem.card2"), title: "Audiences can't play", line: "Chat calls every outcome live, with nothing on the line.", art: <ChatPoll beat={beat} from={cueBeat("problem.card2")} /> },
    { at: cueBeat("problem.card3"), title: "Real money is hard", line: "Seed phrases, extensions, and someone else holding the pot.", art: <SeedWall beat={beat} from={cueBeat("problem.card3")} /> }
  ];
  const current = cards.filter((c) => beat >= c.at).length - 1;
  return (
    <Frame inP={inP} outP={outP} beat={beat} id="problem">
      <div style={{ position: "absolute", left: 120, top: 104, right: 120 }}>
        <Chapter label="The problem" p={prog(beat, s, 0.6)} />
        <div style={{ marginTop: 26 }}><Headline text={<>Great markets. <span style={{ color: C.text2 }}>Lonely experience.</span></>} p={prog(beat, s + 0.2, 0.8, easeOutQuint)} /></div>
      </div>
      <div style={{ position: "absolute", left: 120, right: 120, top: 330, display: "flex", gap: 30 }}>
        {cards.map((c, i) => {
          const p = pop(beat, c.at);
          const focus = i === current ? 1 : 0;
          return (
            <Glass key={c.title} glow={focus * (1 - prog(beat, c.at + 2.5, 2))} tone={i === 2 ? C.xp : C.neon} style={{
              flex: 1, padding: 26, height: 520, opacity: clamp(p * 1.3) * (i <= current ? (focus ? 1 : 0.62) : 0), transform: `translateY(${(1 - p) * 60}px) scale(${0.94 + 0.06 * p})`
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                <span style={{ fontFamily: F.mono, fontWeight: 800, fontSize: 22, color: i === 2 ? C.xp : C.neon }}>0{i + 1}</span>
                <span style={{ height: 1, flex: 1, background: C.borderStrong }} />
              </div>
              {c.art}
              <div style={{ fontFamily: F.text, fontWeight: 800, fontSize: 38, letterSpacing: -1, color: C.text, marginTop: 30 }}>{c.title}</div>
              <div style={{ fontFamily: F.text, fontWeight: 500, fontSize: 24, lineHeight: 1.35, color: C.text2, marginTop: 10 }}>{c.line}</div>
            </Glass>
          );
        })}
      </div>
    </Frame>
  );
};

// ── The Pit: logo, two layers, four steps ─────────────────────────────

const Chip: React.FC<{ children: React.ReactNode; tone: string; p?: number }> = ({ children, tone, p = 1 }) => (
  <span style={{
    fontFamily: F.text, fontWeight: 700, fontSize: 19, color: C.text, padding: "8px 14px", borderRadius: 10, whiteSpace: "nowrap",
    background: rgba(tone, 0.12), border: `1px solid ${rgba(tone, 0.4)}`, opacity: p, transform: `translateY(${(1 - p) * 10}px)`
  }}>{children}</span>
);

export const SolutionSlide: React.FC<{ beat: number }> = ({ beat }) => {
  const { inP, outP, on } = slideP(beat, "solution", 0.3);
  if (!on) return null;
  const s = at("solution");
  const logoIn = prog(beat, s, 0.6, (t) => easeOutBack(t, 1.5));
  const toHeader = prog(beat, s + 2.2, 1.1, easeOutQuint);
  const ring = prog(beat, s, 1.6, easeOutCubic);
  const pulse = beatPulse(beat);
  const l1 = prog(beat, cueBeat("solution.layer1"), 0.6, easeOutQuint);
  const l2 = prog(beat, cueBeat("solution.layer2"), 0.6, easeOutQuint);
  const steps = [
    ["Host a pit on any market", "A Panta market, a new one, or BTC · ETH · SOL", cueBeat("solution.step1")],
    ["Everyone takes the same seat", "Same entry, same vault: skill decides", cueBeat("solution.step2")],
    ["The room trades its own odds", "Every buy and sell moves the line for everyone", cueBeat("solution.step3")],
    ["The best vaults split the pool", "62.5% · 23.4375% · 14.0625%", cueBeat("solution.step4")]
  ] as const;
  // Logo: centre → top-left header.
  const size = 250 - 180 * toHeader;
  const lx = 960 + (120 - 960) * toHeader;
  const ly = 330 - 230 * toHeader;
  return (
    <Frame inP={inP} outP={outP} beat={beat} id="solution">
      <div style={{ position: "absolute", left: 960 - 500 * ring, top: 455 - 500 * ring, width: 1000 * ring, height: 1000 * ring, borderRadius: "50%", border: `2px solid ${rgba(C.neon, 0.5 * (1 - ring))}`, opacity: 1 - toHeader }} />
      <div style={{ position: "absolute", left: lx, top: ly, display: "flex", alignItems: "center", gap: 22 + 10 * (1 - toHeader), transform: `translateX(${-50 * (1 - toHeader)}%) scale(${0.6 + 0.4 * logoIn})`, transformOrigin: "left center", opacity: clamp(logoIn * 1.5) }}>
        <div style={{ filter: `drop-shadow(0 0 ${24 + pulse * 18}px ${rgba(C.neon, 0.5)})` }}><BrandMark size={size} id="sol" glow={1} /></div>
        <Wordmark size={size * 0.34} />
      </div>
      <div style={{ position: "absolute", left: 120, top: 226, right: 120 }}>
        <Headline size={58} text={<>The <span style={{ background: `linear-gradient(90deg, ${C.neon}, ${C.plasma})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>experience layer</span> for prediction markets.</>}
          p={prog(beat, s + 2.7, 0.8, easeOutQuint)} />
      </div>
      {/* Two layers */}
      <div style={{ position: "absolute", left: 120, top: 400, width: 780, display: "flex", flexDirection: "column", gap: 18 }}>
        <Glass glow={0.6 * l1} style={{ padding: "24px 26px", opacity: l1, transform: `translateY(${(1 - l1) * 30}px)` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
            <BrandMark size={44} id="layer" />
            <div><div style={{ fontFamily: F.text, fontWeight: 800, fontSize: 30, color: C.text }}>The Pit</div><div style={{ fontFamily: F.mono, fontSize: 17, letterSpacing: 2, color: C.neon, textTransform: "uppercase" }}>Experience layer</div></div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {["Pits & rooms", "Room odds", "USDC escrow", "Payouts", "Creator tools"].map((c, i) => <Chip key={c} tone={C.neon} p={prog(beat, cueBeat("solution.layer1") + 0.2 + i * 0.12, 0.4)}>{c}</Chip>)}
          </div>
        </Glass>
        <div style={{ height: 30, display: "flex", justifyContent: "center", gap: 120, opacity: l2 }}>
          {[0, 1, 2].map((i) => <span key={i} style={{ width: 2, height: 30, background: `linear-gradient(${C.neon}, ${C.gold})`, opacity: 0.6 }} />)}
        </div>
        <Glass glow={0.6 * l2} tone={C.gold} style={{ padding: "24px 26px", opacity: l2, transform: `translateY(${(1 - l2) * 30}px)` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
            <span style={{ width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center", background: rgba(C.gold, 0.14), border: `1px solid ${rgba(C.gold, 0.5)}`, color: C.gold }}><svg width="24" height="24" viewBox="0 0 24 24"><path d="M4 19h16M7 16V9M12 16V5M17 16v-4" stroke={C.gold} strokeWidth="2.2" strokeLinecap="round" /></svg></span>
            <div><div style={{ fontFamily: F.text, fontWeight: 800, fontSize: 30, color: C.text }}>Panta</div><div style={{ fontFamily: F.mono, fontSize: 17, letterSpacing: 2, color: C.gold, textTransform: "uppercase" }}>Market layer</div></div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {["Markets", "Opening line", "Resolution", "Market creation"].map((c, i) => <Chip key={c} tone={C.gold} p={prog(beat, cueBeat("solution.layer2") + 0.2 + i * 0.12, 0.4)}>{c}</Chip>)}
          </div>
        </Glass>
      </div>
      {/* Four steps */}
      <div style={{ position: "absolute", left: 980, top: 400, right: 120, display: "flex", flexDirection: "column", gap: 16 }}>
        {steps.map(([t, sub, a], i) => {
          const p = pop(beat, a);
          const lit = 1 - prog(beat, a + 1.6, 1.4);
          return (
            <Glass key={t} glow={lit * 0.8} tone={i === 3 ? C.gold : C.plasma} style={{ padding: "18px 22px", display: "flex", alignItems: "center", gap: 20, opacity: clamp(p * 1.3), transform: `translateX(${(1 - p) * 60}px)` }}>
              <span style={{ width: 54, height: 54, borderRadius: 16, display: "grid", placeItems: "center", flexShrink: 0, fontFamily: F.mono, fontWeight: 800, fontSize: 24, color: "#051018", background: i === 3 ? `linear-gradient(180deg, ${C.gold}, #f59e0b)` : `linear-gradient(180deg, ${C.plasma}, #0891b2)` }}>{i + 1}</span>
              <div>
                <div style={{ fontFamily: F.text, fontWeight: 800, fontSize: 28, color: C.text, letterSpacing: -0.6 }}>{t}</div>
                <div style={{ fontFamily: F.text, fontWeight: 500, fontSize: 20, color: C.text2, marginTop: 3 }}>{sub}</div>
              </div>
            </Glass>
          );
        })}
      </div>
    </Frame>
  );
};

// ── Who it's for ──────────────────────────────────────────────────────

const PersonaIcon: React.FC<{ kind: number }> = ({ kind }) => (
  <svg width="56" height="56" viewBox="0 0 24 24" style={{ display: "block" }}>
    {kind === 0 && <><path d="M3 17l5-5 4 3 7-8" fill="none" stroke={C.plasma} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M15 7h4v4" fill="none" stroke={C.plasma} strokeWidth="2" strokeLinecap="round" /></>}
    {kind === 1 && <><rect x="3" y="6" width="13" height="12" rx="2.5" fill="none" stroke={C.neon} strokeWidth="2" /><path d="M16 10.5l5-3v9l-5-3" fill="none" stroke={C.neon} strokeWidth="2" strokeLinejoin="round" /><circle cx="7" cy="10" r="1.6" fill="#ef4444" /></>}
    {kind === 2 && <><path d="M4 6h11a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" fill="none" stroke={C.gold} strokeWidth="2" strokeLinejoin="round" /><path d="M19 9h1a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-1v2.5L16 17" fill="none" stroke={C.gold} strokeWidth="1.6" strokeLinejoin="round" /></>}
  </svg>
);

export const AudienceSlide: React.FC<{ beat: number }> = ({ beat }) => {
  const { inP, outP, on } = slideP(beat, "audience");
  if (!on) return null;
  const s = at("audience");
  const cards = [
    { title: "Traders", tone: C.plasma, a: cueBeat("audience.card1"), points: ["Compete on skill, not bankroll", "Same seat, same vault, live rankings"] },
    { title: "Streamers & creators", tone: C.neon, a: cueBeat("audience.card2"), points: ["Your audience plays, not just watches", "Join code, QR and a stream overlay"] },
    { title: "Communities", tone: C.gold, a: cueBeat("audience.card3"), points: ["Game night on any market", "Group chats, Discords, X Spaces"] }
  ];
  return (
    <Frame inP={inP} outP={outP} beat={beat} id="audience">
      <div style={{ position: "absolute", left: 120, top: 104, right: 120 }}>
        <Chapter label="Who it's for" p={prog(beat, s, 0.6)} />
        <div style={{ marginTop: 26 }}><Headline text={<>For everyone who already <span style={{ color: C.plasma }}>calls it.</span></>} p={prog(beat, s + 0.2, 0.8, easeOutQuint)} /></div>
      </div>
      <div style={{ position: "absolute", left: 120, right: 120, top: 360, display: "flex", gap: 30 }}>
        {cards.map((c, i) => {
          const p = pop(beat, c.a);
          return (
            <Glass key={c.title} tone={c.tone} glow={0.7 * (1 - prog(beat, c.a + 1.2, 1.5))} style={{ flex: 1, padding: "34px 34px 38px", opacity: clamp(p * 1.3), transform: `translateY(${(1 - p) * 60}px)` }}>
              <div style={{ width: 92, height: 92, borderRadius: 24, display: "grid", placeItems: "center", background: rgba(c.tone, 0.12), border: `1px solid ${rgba(c.tone, 0.45)}` }}>
                <PersonaIcon kind={i} />
              </div>
              <div style={{ fontFamily: F.text, fontWeight: 800, fontSize: 42, letterSpacing: -1.2, color: C.text, marginTop: 28 }}>{c.title}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 22 }}>
                {c.points.map((pt) => (
                  <div key={pt} style={{ display: "flex", gap: 12, alignItems: "flex-start", fontFamily: F.text, fontWeight: 500, fontSize: 25, lineHeight: 1.3, color: C.text2 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: c.tone, marginTop: 11, flexShrink: 0 }} />{pt}
                  </div>
                ))}
              </div>
            </Glass>
          );
        })}
      </div>
    </Frame>
  );
};

// ── Under the hood ────────────────────────────────────────────────────

const Row: React.FC<{ title: string; sub?: string; lit?: number; tone: string; p?: number }> = ({ title, sub, lit = 0, tone, p = 1 }) => (
  <div style={{
    padding: "11px 14px", borderRadius: 12, background: lit > 0 ? rgba(tone, 0.08 + lit * 0.12) : "rgba(10,13,19,0.55)",
    border: `1px solid ${lit > 0 ? rgba(tone, 0.35 + lit * 0.5) : C.border}`, boxShadow: lit > 0 ? `0 0 ${26 * lit}px ${rgba(tone, 0.35 * lit)}` : undefined,
    opacity: p, transform: `translateX(${(1 - p) * 20}px)`
  }}>
    <div style={{ fontFamily: F.text, fontWeight: 700, fontSize: 21, color: C.text }}>{title}</div>
    {sub && <div style={{ fontFamily: F.mono, fontSize: 15, color: C.text2, marginTop: 3 }}>{sub}</div>}
  </div>
);

const NodeHead: React.FC<{ title: string; kicker: string; tone: string; icon?: React.ReactNode }> = ({ title, kicker, tone, icon }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
    {icon}
    <div>
      <div style={{ fontFamily: F.mono, fontSize: 14, letterSpacing: 2.4, color: tone, textTransform: "uppercase", fontWeight: 700 }}>{kicker}</div>
      <div style={{ fontFamily: F.text, fontWeight: 800, fontSize: 28, color: C.text, letterSpacing: -0.6 }}>{title}</div>
    </div>
  </div>
);

/** A connector with packets flowing along it. */
const Wire: React.FC<{ x1: number; y1: number; x2: number; y2: number; beat: number; tone: string; p: number; label?: string; speed?: number }> = ({ x1, y1, x2, y2, beat, tone, p, label, speed = 0.5 }) => {
  const mx = (x1 + x2) / 2;
  const d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  const len = Math.hypot(x2 - x1, y2 - y1) * 1.15;
  return (
    <g opacity={p}>
      <path d={d} fill="none" stroke={rgba(tone, 0.35)} strokeWidth={2} strokeDasharray={len} strokeDashoffset={len * (1 - p)} />
      {[0, 0.33, 0.66].map((o) => {
        const t = (beat * speed + o) % 1;
        const bx = (1 - t) ** 3 * x1 + 3 * (1 - t) ** 2 * t * mx + 3 * (1 - t) * t * t * mx + t ** 3 * x2;
        const by = (1 - t) ** 3 * y1 + 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3 * y2;
        return <circle key={o} cx={bx} cy={by} r={4} fill={tone} opacity={p} style={{ filter: `drop-shadow(0 0 6px ${tone})` }} />;
      })}
      {label && <text x={mx} y={(y1 + y2) / 2 - 12} textAnchor="middle" fontFamily={F.mono} fontSize={14} fill={C.text2}>{label}</text>}
    </g>
  );
};

export const TechSlide: React.FC<{ beat: number }> = ({ beat }) => {
  const { inP, outP, on } = slideP(beat, "tech");
  if (!on) return null;
  const s = at("tech");
  const nA = prog(beat, s + 0.2, 0.6, easeOutQuint);
  const nB = prog(beat, s + 0.6, 0.6, easeOutQuint);
  const nC = prog(beat, cueBeat("tech.panta") - 0.4, 0.6, easeOutQuint);
  const nD = prog(beat, cueBeat("tech.escrow") - 0.5, 0.6, easeOutQuint);
  const lit = (a: number) => (beat >= a ? 1 - prog(beat, a + 2.6, 1.6) * 0.65 : 0);
  const book = lit(cueBeat("tech.book"));
  const guarantee = prog(beat, cueBeat("tech.guarantee"), 0.6, (t) => easeOutBack(t, 1.4));
  const curve = Array.from({ length: 41 }, (_, i) => { const x = (i - 20) / 7; return `${i ? "L" : "M"}${i * 5},${60 - 56 / (1 + Math.exp(-x))}`; }).join("");
  return (
    <Frame inP={inP} outP={outP} beat={beat} id="tech">
      <div style={{ position: "absolute", left: 120, top: 92, right: 120 }}>
        <Chapter label="Under the hood" p={prog(beat, s, 0.6)} />
        <div style={{ marginTop: 22 }}><Headline size={56} text={<><span style={{ color: C.gold }}>Panta</span> for the market. <span style={{ color: C.plasma }}>Solana</span> for the money.</>} p={prog(beat, s + 0.2, 0.8, easeOutQuint)} /></div>
      </div>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <Wire x1={470} y1={560} x2={620} y2={560} beat={beat} tone={C.neon} p={nB} />
        <Wire x1={1120} y1={430} x2={1270} y2={400} beat={beat} tone={C.gold} p={nC} />
        <Wire x1={1120} y1={700} x2={1270} y2={750} beat={beat} tone={C.plasma} p={nD} speed={0.35} />
        <Wire x1={300} y1={760} x2={1270} y2={850} beat={beat} tone={C.up} p={nD} label="players sign deposits & withdrawals" speed={0.3} />
      </svg>
      {/* Players */}
      <Glass style={{ position: "absolute", left: 120, top: 330, width: 350, padding: 22, opacity: nA, transform: `translateY(${(1 - nA) * 30}px)` }} tone={C.neon}>
        <NodeHead kicker="Players" title="Browser" tone={C.neon} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {PLAYERS.map((p) => <Avatar key={p.id} seed={p.seed} size={34} radius={9} />)}
        </div>
        <Row tone={C.neon} title="Sign in with X" sub="one tap, no extension" />
        <div style={{ height: 8 }} />
        <Row tone={C.neon} title="Embedded Solana wallet" sub="via Privy, per X account" />
        <div style={{ position: "absolute", right: 18, top: 22, color: C.text }}><XLogo size={22} /></div>
      </Glass>
      {/* Server */}
      <Glass style={{ position: "absolute", left: 620, top: 300, width: 500, padding: 22, opacity: nB, transform: `translateY(${(1 - nB) * 30}px)` }} tone={C.neon}>
        <NodeHead kicker="Next.js server" title="The Pit engine" tone={C.neon} icon={<BrandMark size={44} id="tech" />} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Row tone={C.neon} title="Pit engine" sub="rounds · cuts · rankings" />
          <div style={{ position: "relative" }}>
            <Row tone={C.plasma} lit={book} title="Room book · LMSR" sub="seeded at Panta's line · b = Σ vaults" />
            {book > 0 && (
              <svg width="84" height="40" viewBox="0 0 200 64" preserveAspectRatio="none" style={{ position: "absolute", right: 12, top: 14, opacity: book }}>
                <path d={curve} fill="none" stroke={C.plasma} strokeWidth="2.4" />
              </svg>
            )}
          </div>
          <Row tone={C.neon} title="TWAP settlement" sub="closing-window average · no sniping" />
          <Row tone={C.neon} title="Oracle read" sub="lean computed · phrased by Claude" />
        </div>
      </Glass>
      {/* Panta */}
      <Glass style={{ position: "absolute", left: 1270, top: 250, width: 530, padding: 22, opacity: nC, transform: `translateX(${(1 - nC) * 40}px)` }} tone={C.gold} glow={0.5 * lit(cueBeat("tech.panta"))}>
        <NodeHead kicker="Market layer" title="Panta API" tone={C.gold} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Row tone={C.gold} lit={lit(cueBeat("tech.markets"))} title="Markets" sub="catalog" />
          <Row tone={C.gold} lit={lit(cueBeat("tech.line"))} title="Opening line" sub="YES price" />
          <Row tone={C.gold} lit={lit(cueBeat("tech.resolution"))} title="Resolution" sub="$1 / $0" />
          <Row tone={C.gold} title="Create market" sub="quote · sign · register" />
        </div>
      </Glass>
      {/* Escrow */}
      <Glass style={{ position: "absolute", left: 1270, top: 620, width: 530, padding: 22, opacity: nD, transform: `translateX(${(1 - nD) * 40}px)` }} tone={C.plasma} glow={0.6 * lit(cueBeat("tech.escrow"))}>
        <NodeHead kicker="Solana program" title="Non-custodial escrow" tone={C.plasma} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["Deposit", "SettlePlayer", "Claim", "Recover"].map((x) => (
            <span key={x} style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 17, color: C.text, padding: "8px 12px", borderRadius: 9, background: "rgba(10,13,19,0.6)", border: `1px solid ${C.borderStrong}` }}>{x}</span>
          ))}
        </div>
        <div style={{
          marginTop: 14, padding: "12px 14px", borderRadius: 12, display: "flex", alignItems: "center", gap: 12,
          background: rgba(C.up, 0.1 * guarantee), border: `1px solid ${rgba(C.up, 0.6 * guarantee)}`, opacity: clamp(guarantee * 1.4), transform: `scale(${0.9 + 0.1 * guarantee})`, transformOrigin: "left center",
          boxShadow: `0 0 ${30 * guarantee}px ${rgba(C.up, 0.3 * guarantee)}`
        }}>
          <svg width="30" height="30" viewBox="0 0 24 24"><path d="M12 3l7 3v6c0 4.2-3 7.6-7 9-4-1.4-7-4.8-7-9V6z" fill="none" stroke={C.up} strokeWidth="2" strokeLinejoin="round" /><path d="M8.5 12l2.4 2.4L15.5 9.8" fill="none" stroke={C.up} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <div>
            <div style={{ fontFamily: F.mono, fontWeight: 800, fontSize: 19, color: C.up }}>Σ payouts ≤ Σ deposits</div>
            <div style={{ fontFamily: F.text, fontSize: 16, color: C.text2 }}>Enforced on-chain · full seat back if a pit never settles</div>
          </div>
        </div>
      </Glass>
    </Frame>
  );
};

// ── Formats & fees ────────────────────────────────────────────────────

export const FormatsSlide: React.FC<{ beat: number }> = ({ beat }) => {
  const { inP, outP, on } = slideP(beat, "formats", 0.6, 0.45);
  if (!on) return null;
  const s = at("formats");
  const fmts = [
    ["Single", "One round. The top finishers split the pool.", C.plasma, cueBeat("formats.card1")],
    ["Royale", "2–4 rounds. The bottom half is cut each round.", C.neon, cueBeat("formats.card2")],
    ["Predictions", "Five hidden picks on BTC, ETH and SOL.", C.gold, cueBeat("formats.card3")],
    ["Streak", "One call per leg. Wrong and you're out.", C.xp, cueBeat("formats.card4")]
  ] as const;
  const fees = prog(beat, cueBeat("formats.fees"), 0.5, easeOutQuint);
  return (
    <Frame inP={inP} outP={outP} beat={beat} id="formats">
      <div style={{ position: "absolute", left: 120, top: 150, right: 120 }}>
        <Chapter label="Formats & fees" p={prog(beat, s, 0.5)} />
      </div>
      <div style={{ position: "absolute", left: 120, right: 120, top: 260, display: "flex", gap: 24 }}>
        {fmts.map(([t, d, tone, a]) => {
          const p = pop(beat, a);
          return (
            <Glass key={t} tone={tone} glow={0.6 * (1 - prog(beat, a + 0.8, 1.2))} style={{ flex: 1, padding: "30px 28px", minHeight: 300, opacity: clamp(p * 1.3), transform: `translateY(${(1 - p) * 50}px)` }}>
              <div style={{ fontFamily: F.display, fontWeight: 900, fontSize: 30, letterSpacing: 2, color: tone, textTransform: "uppercase" }}>{t}</div>
              <div style={{ fontFamily: F.text, fontWeight: 600, fontSize: 28, lineHeight: 1.3, color: C.text, marginTop: 18 }}>{d}</div>
            </Glass>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 120, right: 120, top: 660, display: "flex", gap: 20, opacity: fees, transform: `translateY(${(1 - fees) * 30}px)` }}>
        {[["Host fee", "0–5% of the pool", C.gold], ["Platform fee", "0.1% on claims", C.plasma], ["Refunds & recoveries", "fee-free", C.up]].map(([k, v, tone]) => (
          <div key={k} style={{ flex: 1, padding: "22px 26px", borderRadius: 20, background: rgba(tone, 0.08), border: `1px solid ${rgba(tone, 0.45)}`, display: "flex", alignItems: "baseline", gap: 16 }}>
            <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 22, letterSpacing: 2, color: tone, textTransform: "uppercase" }}>{k}</span>
            <span style={{ fontFamily: F.text, fontWeight: 800, fontSize: 34, color: C.text }}>{v}</span>
          </div>
        ))}
      </div>
    </Frame>
  );
};
