import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame } from "remotion";
import { clamp, easeOutBack, prog } from "../anim";
import { Backdrop } from "../film/Backdrop";
import { BrowserFrame } from "../device";
import { F } from "../fonts";
import { PitPage } from "../scenes/PitPage";
import { C, rgba } from "../theme";
import { at as demoAt, PIT } from "../timeline";
import { BrandMark, Wordmark } from "../ui/brand";
import { QR } from "../ui/pit/CreatorKit";
import { PROJECTS, T } from "./cues";
import { GITHUB, SPEAKER_NAME } from "./narration";
import { Subtitles } from "./Subtitles";
import { DURATION_IN_FRAMES, SECTIONS, frameToBeat, section, type SectionId } from "./timeline";
import envelope from "./voice-envelope.json";

const W = 1920;
const labels: Record<SectionId, string> = {
  intro: "The builder", who: "Who I am", ship: "What I've shipped",
  problem: "The problem", pit: "The Pit", why: "Why this matters", close: "Build with me"
};
const b = (id: SectionId) => section(id).startBeat;
const box = (tone: string = C.neon): React.CSSProperties => ({
  background: "linear-gradient(150deg, rgba(24,29,44,.96), rgba(11,15,24,.97))",
  border: `1px solid ${rgba(tone, 0.34)}`, borderRadius: 26,
  boxShadow: `0 30px 80px rgba(0,0,0,.42), inset 0 1px rgba(255,255,255,.035)`
});
const eyebrow: React.CSSProperties = { fontFamily: F.mono, fontWeight: 700, fontSize: 23, letterSpacing: 4, color: C.plasma, textTransform: "uppercase" };
const headline: React.CSSProperties = { fontFamily: F.text, fontWeight: 800, fontSize: 88, lineHeight: 1.03, letterSpacing: -3.5, color: C.text };
const body: React.CSSProperties = { fontFamily: F.text, fontWeight: 500, fontSize: 27, lineHeight: 1.35, color: C.text2 };

function sceneVisibility(beat: number, id: SectionId) {
  const s = section(id);
  if (beat < s.startBeat - 0.35 || beat > s.endBeat + 0.04) return 0;
  const enter = id === "intro" ? 1 : prog(beat, s.startBeat - 0.35, 0.65);
  const leave = id === "close" ? 0 : prog(beat, s.endBeat - 0.55, 0.55);
  return enter * (1 - leave);
}

const Scene: React.FC<{ id: SectionId; beat: number; children: React.ReactNode }> = ({ id, beat, children }) => {
  const opacity = sceneVisibility(beat, id);
  if (opacity <= 0) return null;
  const s = section(id);
  const drift = clamp((beat - s.startBeat) / Math.max(1, s.endBeat - s.startBeat));
  return <div style={{ position: "absolute", inset: 0, opacity, transform: `scale(${0.985 + drift * 0.025})` }}>{children}</div>;
};

const Appear: React.FC<{ beat: number; from: number; children: React.ReactNode; dx?: number; dy?: number; style?: React.CSSProperties }> = ({ beat, from, children, dx = 0, dy = 28, style }) => {
  const p = prog(beat, from, 0.65, (t) => easeOutBack(t, 1.15));
  return <div style={{ opacity: clamp(p * 1.15), transform: `translate(${(1 - p) * dx}px, ${(1 - p) * dy}px)`, ...style }}>{children}</div>;
};

const Progress: React.FC<{ frame: number; beat: number }> = ({ frame, beat }) => {
  const active = [...SECTIONS].reverse().find((s) => beat >= s.startBeat) ?? SECTIONS[0];
  return <div style={{ position: "absolute", left: 90, right: 90, top: 48, display: "flex", alignItems: "center", zIndex: 30 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}><BrandMark size={43} id="pitch-header" glow={0.4} /><Wordmark size={24} /></div>
    <div style={{ marginLeft: 48, height: 22, width: 1, background: C.borderStrong }} />
    <span style={{ ...eyebrow, marginLeft: 30, fontSize: 17, color: C.text2, letterSpacing: 3 }}>{labels[active.id]}</span>
    <div style={{ flex: 1 }} />
    <span style={{ fontFamily: F.mono, color: C.text2, fontSize: 16, letterSpacing: 2 }}>COLOSSEUM · BUILDER PITCH</span>
    <div style={{ position: "absolute", top: 65, left: 0, right: 0, height: 2, background: rgba(C.text, .08) }}>
      <div style={{ width: `${(frame / Math.max(1, DURATION_IN_FRAMES - 1)) * 100}%`, height: "100%", background: `linear-gradient(90deg, ${C.neon}, ${C.plasma})` }} />
    </div>
  </div>;
};

const Wave: React.FC<{ frame: number }> = ({ frame }) => <div style={{ position: "absolute", right: 91, bottom: 51, width: 180, height: 32, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3, opacity: .72, zIndex: 20 }}>
  {Array.from({ length: 39 }, (_, i) => {
    const idx = Math.max(0, Math.min(envelope.length - 1, frame - (38 - i) * 2));
    const v = envelope[idx] ?? 0;
    return <span key={i} style={{ width: 2, height: 3 + v * 27, borderRadius: 2, background: i > 28 ? C.plasma : C.neon, opacity: .48 + v * .52 }} />;
  })}
</div>;

const Intro: React.FC<{ beat: number }> = ({ beat }) => {
  const name = prog(beat, T.name, .8, (t) => easeOutBack(t, 1.12));
  const pit = prog(beat, T.pitName, .85, (t) => easeOutBack(t, 1.14));
  const pulse = Math.max(0, 1 - prog(beat, T.pitName, 2));
  return <Scene id="intro" beat={beat}>
    <div style={{ position: "absolute", left: 130, top: 280, width: 960 }}>
      <div style={{ ...eyebrow, color: C.neon }}>FINANCE × SECURITY × BUILDING</div>
      <div style={{ fontFamily: F.display, fontSize: 143, fontWeight: 900, letterSpacing: -5, lineHeight: 1, color: C.text, marginTop: 28, transform: `translateY(${(1 - name) * 34}px)`, opacity: name, textShadow: `0 0 44px ${rgba(C.neon, .23)}` }}>{SPEAKER_NAME.toUpperCase()}</div>
      <div style={{ ...body, fontSize: 39, marginTop: 30, maxWidth: 770 }}>I build where markets, incentives, and security meet.</div>
      <div style={{ marginTop: 78, opacity: pit, transform: `translateY(${(1 - pit) * 30}px)`, display: "flex", alignItems: "center", gap: 17 }}><div style={{ width: 58, height: 3, background: C.plasma }} /><span style={{ fontFamily: F.display, fontSize: 41, letterSpacing: 3, color: C.plasma }}>BUILDING THE PIT</span></div>
    </div>
    <div style={{ position: "absolute", left: 1190, top: 225, width: 540, height: 540, display: "grid", placeItems: "center" }}>
      {[485, 380, 295].map((size, i) => <div key={i} style={{ position: "absolute", width: size, height: size, borderRadius: "50%", border: `1px solid ${rgba(i === 1 ? C.plasma : C.neon, .15 + pit * .14)}`, transform: `rotate(${beat * (i % 2 ? -2 : 2)}deg) scale(${1 + pulse * .04})`, boxShadow: i === 2 ? `0 0 110px ${rgba(C.neon, .13)}` : "none" }} />)}
      <div style={{ transform: `scale(${1.2 + pit * .13})`, filter: `drop-shadow(0 0 ${22 + pit * 25}px ${rgba(C.neon, .35)})` }}><BrandMark size={280} id="pitch-hero" glow={.8 + pit * .2} /></div>
    </div>
    <div style={{ position: "absolute", left: 130, bottom: 93, fontFamily: F.mono, fontSize: 19, letterSpacing: 3, color: C.text3 }}>01 / THE BUILDER</div>
  </Scene>;
};

const Who: React.FC<{ beat: number }> = ({ beat }) => {
  const cards = [
    { key: "FINANCE", tone: C.gold, at: T.finance, title: "Risk. Incentives. Custody.", sub: "The design starts with who holds the money and who earns it.", bits: [["RISK", T.risk], ["INCENTIVES", T.incentives], ["CUSTODY", T.custody]] as const },
    { key: "SECURITY", tone: C.plasma, at: T.security, title: "Read it. Break it. Fix it.", sub: "Research and bug bounties taught me to test the edges.", bits: [["READ CODE", T.readCode], ["ASSUME ATTACKS", T.breaks]] as const },
    { key: "BUILDER", tone: C.neon, at: T.builder, title: "Make the idea real.", sub: "I turn that thinking into products people can use.", bits: [["DESIGN", T.builder], ["BUILD", T.builder + .55], ["SHIP", T.builder + 1.1]] as const }
  ];
  return <Scene id="who" beat={beat}>
    <div style={{ position: "absolute", left: 120, right: 120, top: 150 }}><div style={eyebrow}>01 / WHO I AM</div><div style={{ ...headline, marginTop: 26 }}>I think like a trader.<br /><span style={{ color: C.neon }}>I build like a researcher.</span></div></div>
    <div style={{ position: "absolute", left: 120, right: 120, top: 425, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 22 }}>
      {cards.map((c, i) => <Appear key={c.key} beat={beat} from={c.at} dy={56} style={{ ...box(c.tone), height: 450, padding: 34, position: "relative", overflow: "hidden" }}>
        <div style={{ ...eyebrow, fontSize: 18, color: c.tone }}>{`0${i + 1}`} / {c.key}</div>
        <div style={{ fontFamily: F.text, fontWeight: 800, color: C.text, fontSize: 45, lineHeight: 1.1, marginTop: 31, maxWidth: 445 }}>{c.title}</div>
        <div style={{ ...body, fontSize: 22, marginTop: 18 }}>{c.sub}</div>
        <div style={{ position: "absolute", left: 34, right: 34, bottom: 36, display: "flex", gap: 9, flexWrap: "wrap" }}>{c.bits.map(([label, at]) => <div key={label} style={{ fontFamily: F.mono, fontSize: 15, fontWeight: 700, letterSpacing: 1.1, color: c.tone, padding: "10px 12px", borderRadius: 9, border: `1px solid ${rgba(c.tone, .5)}`, background: rgba(c.tone, .11), opacity: prog(beat, at, .35) }}>{label}</div>)}</div>
      </Appear>)}
    </div>
  </Scene>;
};

const Ship: React.FC<{ beat: number }> = ({ beat }) => {
  const focus = beat >= T.taxpilot ? "TaxPilot" : beat >= T.tacit ? "Tacit" : beat >= T.covenant ? "Covenant" : "";
  return <Scene id="ship" beat={beat}>
    <div style={{ position: "absolute", left: 120, right: 120, top: 145 }}><div style={eyebrow}>02 / WHAT I'VE SHIPPED</div><div style={{ ...headline, marginTop: 22 }}>Ten public projects. <span style={{ color: C.neon }}>One through-line.</span></div></div>
    <div style={{ position: "absolute", left: 120, right: 120, top: 346, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
      {PROJECTS.map((p, i) => {
        const t = prog(beat, T.chips + i * T.chipStep, .38, (x) => easeOutBack(x, 1.1));
        const hi = p.name === focus;
        return <div key={p.name} style={{ ...box(hi ? C.plasma : p.star ? C.neon : C.borderStrong), height: 224, padding: 23, opacity: t * (focus && !hi ? .72 : 1), transform: `translateY(${(1 - t) * 34}px) scale(${hi ? 1.035 : 1})`, transition: "none" }}>
          <div style={{ ...eyebrow, fontSize: 15, letterSpacing: 2, color: p.star ? C.neon : C.text3 }}>{p.m.toUpperCase()} · {String(i + 1).padStart(2, "0")}</div>
          <div style={{ fontFamily: F.text, fontSize: 27, fontWeight: 800, color: C.text, marginTop: 26, lineHeight: 1.1 }}>{p.name}</div>
          <div style={{ fontFamily: F.text, fontSize: 18, color: C.text2, lineHeight: 1.3, marginTop: 10 }}>{p.what}</div>
        </div>;
      })}
    </div>
    <Appear beat={beat} from={T.chains} style={{ position: "absolute", left: 120, right: 120, bottom: 96, display: "flex", alignItems: "center", gap: 20 }}>
      <div style={{ width: 64, height: 2, background: C.plasma }} /><span style={{ fontFamily: F.text, fontSize: 35, color: C.text, fontWeight: 700 }}>Make the money flow <span style={{ color: C.plasma }}>provable.</span></span>
    </Appear>
  </Scene>;
};

const Problem: React.FC<{ beat: number }> = ({ beat }) => {
  const chat = [["night_owl", "YES, easy"], ["0xmango", "I don't think so"], ["sol_sam", "Let's settle this"], ["chartgoblin", "I'd take NO"]] as const;
  const lost = prog(beat, T.noWay, .65);
  return <Scene id="problem" beat={beat}>
    <div style={{ position: "absolute", left: 120, right: 120, top: 148 }}><div style={eyebrow}>03 / THE PROBLEM</div><div style={{ ...headline, marginTop: 25 }}>Markets are individual.<br /><span style={{ color: C.plasma }}>The conversation is social.</span></div></div>
    <div style={{ position: "absolute", left: 120, right: 120, top: 420, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
      <div style={{ ...box(C.text3), height: 425, padding: 36, opacity: 1 - lost * .45 }}><div style={{ ...eyebrow, fontSize: 19, color: C.text3 }}>THE MARKET</div><div style={{ fontFamily: F.mono, color: C.text, fontSize: 25, marginTop: 26 }}>YES 62¢ <span style={{ float: "right", color: C.text3 }}>1 PLAYER</span></div><svg width="100%" height="180" viewBox="0 0 700 180" style={{ marginTop: 24 }}><path d="M0 130 C70 100 100 150 160 110 S250 60 310 90 S400 45 470 70 S570 48 700 22" fill="none" stroke={C.text3} strokeWidth="5" /></svg><div style={{ ...body, fontSize: 26 }}>One person. One ticket. One chart.</div></div>
      <div style={{ ...box(C.plasma), height: 425, padding: 36 }}><div style={{ ...eyebrow, fontSize: 19 }}>THE GROUP CHAT</div><div style={{ marginTop: 23, display: "flex", flexDirection: "column", gap: 13 }}>{chat.map(([name, message], i) => <div key={name} style={{ padding: "12px 18px", background: rgba(C.plasma, .08), border: `1px solid ${rgba(C.plasma, .25)}`, borderRadius: 12, fontFamily: F.text, fontSize: 23, color: C.text, opacity: prog(beat, T.bubbles[i], .35), transform: `translateX(${(1 - prog(beat, T.bubbles[i], .4)) * 45}px)` }}><b style={{ color: C.plasma, marginRight: 12 }}>@{name}</b>{message}</div>)}</div></div>
    </div>
    <div style={{ position: "absolute", left: 120, bottom: 100, fontFamily: F.display, fontSize: 30, fontWeight: 800, letterSpacing: 2, color: C.neon, opacity: lost }}>THE CALL SHOULD LIVE IN THE ROOM.</div>
  </Scene>;
};

const Pit: React.FC<{ beat: number }> = ({ beat }) => {
  const virtual = beat < T.step4 ? demoAt("seat") + 7 : beat < T.cut ? demoAt("trade") + 2 + (beat - T.step4) * 2.2 : beat < T.bell ? demoAt("cut") + 2 : demoAt("bell") + 6;
  const scroll = beat >= T.step4 && beat < T.cut ? 590 : beat >= T.bell ? 555 : 0;
  const steps = [
    ["01", "HOST", "Choose a Panta market", T.step1, C.neon],
    ["02", "JOIN", "Sign in with X", T.step2, C.plasma],
    ["03", "ESCROW", "Take a seat", T.step3, C.gold],
    ["04", "TRADE", "Move the room's odds", T.step4, C.up]
  ] as const;
  return <Scene id="pit" beat={beat}>
    <div style={{ position: "absolute", left: 100, top: 144, right: 100 }}><div style={eyebrow}>04 / THE PIT</div><div style={{ ...headline, fontSize: 78, marginTop: 20 }}>A market you <span style={{ color: C.neon }}>play together.</span></div></div>
    <div style={{ position: "absolute", left: 120, top: 365, width: 520, display: "flex", flexDirection: "column", gap: 17 }}>
      {steps.map(([n, title, desc, at, tone]) => <div key={n} style={{ ...box(tone), display: "flex", gap: 19, alignItems: "center", padding: "18px 22px", opacity: prog(beat, at, .35) * (beat > T.cut ? .65 : 1), transform: `translateX(${(1 - prog(beat, at, .45)) * -40}px)` }}><span style={{ fontFamily: F.mono, color: tone, fontSize: 21, fontWeight: 800 }}>{n}</span><div><div style={{ fontFamily: F.display, fontSize: 23, fontWeight: 800, color: C.text, letterSpacing: 1 }}>{title}</div><div style={{ fontFamily: F.text, fontSize: 21, color: C.text2, marginTop: 4 }}>{desc}</div></div></div>)}
      <div style={{ ...box(C.gold), padding: 19, opacity: prog(beat, T.cut, .4), fontFamily: F.text, color: C.text, fontSize: 22 }}><b style={{ color: C.gold }}>ROYALE</b> · Bottom half cut each round. At the bell, top three share the prize pool.</div>
    </div>
    <div style={{ position: "absolute", left: 735, top: 360, width: 1064, height: 610, overflow: "hidden", borderRadius: 18, transform: `translateY(${(1 - prog(beat, b("pit"), .8)) * 50}px)` }}>
      <div style={{ transform: "scale(.94)", transformOrigin: "top left" }}><BrowserFrame url={`/a/${PIT.code}`} glow={.35}><PitPage m={false} beat={virtual} virtualBeat={virtual} scroll={scroll} /></BrowserFrame></div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "9px 15px", background: "rgba(5,7,11,.92)", fontFamily: F.mono, color: C.amber, fontSize: 14, letterSpacing: 1 }}>SIMULATED GAMEPLAY · DEVNET TEST USDC</div>
    </div>
  </Scene>;
};

const Why: React.FC<{ beat: number }> = ({ beat }) => {
  const format = ["ENTRY → PRIZE POOL", "VAULT → TRADING BANKROLL", "ROYALE CUTS", "0.1% CLAIM FEE"];
  const guarantees = ["ONLY PLAYERS WITHDRAW", "PAYOUTS ≤ DEPOSITS", "RECOVER AFTER DEADLINE"];
  const q = prog(beat, T.quote, .75);
  return <Scene id="why" beat={beat}>
    <div style={{ position: "absolute", left: 120, right: 120, top: 145 }}><div style={eyebrow}>05 / WHY THIS BUILDER</div><div style={{ ...headline, marginTop: 22 }}>The game is built around <span style={{ color: C.plasma }}>trust.</span></div></div>
    <div style={{ position: "absolute", left: 120, right: 120, top: 375, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, opacity: 1 - q * .35 }}>
      <div style={{ ...box(C.gold), height: 475, padding: 36 }}><div style={{ ...eyebrow, color: C.gold, fontSize: 20 }}>FINANCE SHAPED THE FORMAT</div><div style={{ fontFamily: F.text, fontSize: 38, fontWeight: 800, color: C.text, marginTop: 24 }}>Skin in the game. Clear incentives.</div><div style={{ display: "flex", flexDirection: "column", gap: 13, marginTop: 28 }}>{format.map((x, i) => <div key={x} style={{ fontFamily: F.mono, color: C.text, fontSize: 20, padding: "11px 17px", borderRadius: 11, background: rgba(C.gold, .1), border: `1px solid ${rgba(C.gold, .23)}`, opacity: prog(beat, T.formatItems[i], .35) }}><span style={{ color: C.gold, marginRight: 17 }}>0{i + 1}</span>{x}</div>)}</div></div>
      <div style={{ ...box(C.plasma), height: 475, padding: 36, opacity: prog(beat, T.escrowCol, .5) }}><div style={{ ...eyebrow, fontSize: 20 }}>SECURITY SHAPED THE ESCROW</div><div style={{ fontFamily: F.text, fontSize: 38, fontWeight: 800, color: C.text, marginTop: 24 }}>The rules live on Solana.</div><div style={{ marginTop: 38, display: "flex", alignItems: "center", gap: 10, fontFamily: F.mono, fontWeight: 700, fontSize: 19, color: C.text }}><span style={{ padding: "11px 16px", borderRadius: 10, background: rgba(C.neon,.14) }}>PLAYER</span><span style={{ color: C.plasma }}>→</span><span style={{ padding: "11px 16px", borderRadius: 10, background: rgba(C.plasma,.14) }}>ESCROW</span><span style={{ color: C.plasma }}>→</span><span style={{ padding: "11px 16px", borderRadius: 10, background: rgba(C.neon,.14) }}>PLAYER</span></div><div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 28 }}>{guarantees.map((x, i) => <div key={x} style={{ fontFamily: F.mono, color: C.plasma, fontSize: 18, letterSpacing: .6, opacity: prog(beat, T.shields[i], .4) }}>✓ {x}</div>)}</div></div>
    </div>
    <div style={{ position: "absolute", left: 145, right: 145, top: 465, padding: "55px 70px", borderRadius: 28, background: "rgba(10,13,19,.98)", border: `1px solid ${rgba(C.neon,.65)}`, boxShadow: `0 0 80px ${rgba(C.neon,.16)}`, fontFamily: F.text, fontWeight: 800, fontSize: 55, lineHeight: 1.18, color: C.text, textAlign: "center", opacity: q, transform: `scale(${.95 + .05 * q})`, pointerEvents: "none" }}>“I break code for a living, so I built The Pit assuming someone will try.”</div>
  </Scene>;
};

const Close: React.FC<{ beat: number }> = ({ beat }) => {
  const live = prog(beat, T.live, .7);
  const url = prog(beat, T.url, .65);
  const thanks = prog(beat, T.thanks, .8);
  return <Scene id="close" beat={beat}>
    <div style={{ position: "absolute", left: 145, top: 260, display: "flex", alignItems: "center", gap: 28 }}><BrandMark size={113} id="pitch-close" glow={.9} /><Wordmark size={60} /></div>
    <div style={{ position: "absolute", left: 145, top: 430, width: 1130 }}><div style={{ ...headline, fontSize: 86 }}>Let's build the next<br /><span style={{ color: C.neon }}>market experience.</span></div><div style={{ ...body, marginTop: 35, fontSize: 32, opacity: live }}>Live on devnet · test USDC</div><div style={{ fontFamily: F.mono, fontSize: 37, color: C.plasma, fontWeight: 800, marginTop: 28, opacity: url }}>trythepit.xyz</div><div style={{ fontFamily: F.mono, fontSize: 22, color: C.text2, marginTop: 23 }}>{GITHUB}</div><div style={{ ...body, color: C.text, marginTop: 40, opacity: thanks }}>Thanks for watching.</div></div>
    <div style={{ position: "absolute", right: 150, top: 380, padding: 18, background: C.text, borderRadius: 20, opacity: prog(beat, T.qr, .45), transform: `scale(${.84 + .16 * prog(beat, T.qr, .45)})` }}><QR size={250} dark={C.bg} light={C.text} /><div style={{ color: C.bg, fontFamily: F.mono, fontWeight: 800, fontSize: 17, textAlign: "center", marginTop: 12 }}>TRY THE PIT</div></div>
  </Scene>;
};

export const PitchFilm: React.FC<{ narration: boolean }> = ({ narration }) => {
  const frame = useCurrentFrame();
  const beat = frameToBeat(frame);
  return <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
    <Backdrop layout="landscape" beat={beat} energy={.72} />
    <Intro beat={beat} /><Who beat={beat} /><Ship beat={beat} /><Problem beat={beat} /><Pit beat={beat} /><Why beat={beat} /><Close beat={beat} />
    <Progress frame={frame} beat={beat} />
    <div style={{ position: "absolute", left: 90, bottom: 52, fontFamily: F.mono, fontSize: 17, color: C.text3, letterSpacing: 2 }}>DEVNET · TEST USDC <span style={{ color: C.borderStrong, margin: "0 12px" }}>│</span> {SPEAKER_NAME.toUpperCase()}</div>
    <Wave frame={frame} />
    {narration && <Subtitles beat={beat} cx={W / 2} />}
    <Audio src={staticFile(narration ? "pitch-soundtrack.wav" : "pitch-music.wav")} />
  </AbsoluteFill>;
};
