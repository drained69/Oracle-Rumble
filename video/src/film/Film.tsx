import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame } from "remotion";
import { easeOutBack, easeOutQuint, prog } from "../anim";
import { BrowserFrame, DeviceRig, REST, VIEW, cameraAt, type CamKey } from "../device";
import { F } from "../fonts";
import { PitPage } from "../scenes/PitPage";
import { AppBg, DeviceOverlays, HostPanelScreen, HostScreen, SigninScreen } from "../scenes/Screens";
import { C, rgba } from "../theme";
import { PIT, at, cueBeat, frameToBeat, section } from "../timeline";
import { Backdrop, DevnetChip, beatPulse, flashAt } from "./Backdrop";
import { Caption } from "./Captions";
import { IntroLockup, OutroLockup, SplitCard, StreamWindow } from "./Extras";
import { AudienceSlide, FormatsSlide, ProblemSlide, SolutionSlide, TechSlide } from "./Slides";
import { Subtitles } from "./Subtitles";

const E = 0.02; // a camera "cut": two keys this close together

// ── Camera path (focus points are in the app's own CSS px) ────────────
function cameraKeys(): CamKey[] {
  const K = (beat: number, z: number, fx?: number, fy?: number, extra: Partial<CamKey> = {}): CamKey => ({ beat, z, fx, fy, ...extra });
  const ORB: [number, number] = [389, 362];
  const s = (id: Parameters<typeof at>[0], rel = 0) => at(id, rel);
  return [
    // Hook: the cover, a slow push toward the room as it empties out.
    K(0, 0.97), K(s("intro", 6), 1.0), K(s("intro", 11.5), 1.14, ...ORB), K(s("signin") - E, 1.14, ...ORB),
    // 01 · Sign in
    K(s("signin", 0), 1.0), K(s("signin", 1.8), 1.0), K(cueBeat("signin.tap") - 0.4, 1.6, 1000, 40, { ay: 470 }), K(cueBeat("signin.done") + 0.3, 1.6, 1000, 40, { ay: 470 }),
    K(cueBeat("signin.done") + 1.3, 1.0), K(s("signin", 9.6), 1.0), K(s("signin", 11.0), 1.3, 820, 300), K(s("signin", 13.4), 1.42, 820, 360),
    K(cueBeat("signin.takeSeat") - 0.2, 1.5, 820, 390), K(s("seat") - E, 1.5, 820, 390),
    // 02 · Take a seat
    K(s("seat", 0), 1.05, 560, 350), K(s("seat", 0.5), 1.05, 560, 350), K(cueBeat("seat.enter") - 0.2, 1.3, 877, 243), K(s("seat", 2.0), 1.15, 560, 300),
    K(cueBeat("seat.yes") - 0.4, 1.3, 470, 200), K(cueBeat("seat.entry") - 0.6, 1.35, 560, 470), K(cueBeat("seat.vault") + 1.2, 1.35, 560, 500),
    K(cueBeat("seat.deposit") - 0.5, 1.3, 560, 560), K(cueBeat("seat.sheet") + 0.4, 1.2, 560, 330), K(cueBeat("seat.approve") + 0.8, 1.2, 560, 330),
    K(cueBeat("seat.seated") - 0.3, 1.0), K(cueBeat("seat.seated") + 0.8, 1.28, 941, 250), K(cueBeat("seat.join7") + 0.6, 1.28, 941, 250),
    K(cueBeat("seat.join7") + 1.8, 1.1, 500, 362), K(s("trade") - E, 1.14, 450, 362),
    // 03 · Trade
    K(s("trade", 0), 1.14, ...ORB), K(s("trade", 1.2), 1.18, ...ORB), K(s("trade", 2.9), 1.18, ...ORB), K(s("trade", 3.9), 1.0),
    K(s("trade", 5.0), 1.25, 314, 160), K(s("trade", 9.0), 1.25, 330, 170), K(s("trade", 10.2), 1.1, 430, 330), K(cueBeat("trade.focus") - 0.6, 1.1, 430, 330),
    K(cueBeat("trade.focus") + 0.1, 1.45, 866, 300), K(cueBeat("trade.key.3") + 0.3, 1.45, 866, 350), K(cueBeat("trade.myFill") + 0.1, 1.4, 866, 440),
    K(cueBeat("trade.myFill") + 1.2, 1.0), K(s("cut") - E, 1.0),
    // 04 · Royale
    K(s("cut", 0), 1.0), K(s("cut", 0.6), 1.28, ...ORB), K(cueBeat("cut.sting") - 0.1, 1.34, ...ORB), K(cueBeat("cut.sting") + 0.15, 1.5, ...ORB),
    K(cueBeat("cut.regroup") - 0.4, 1.3, ...ORB), K(cueBeat("cut.round2") + 1.6, 1.3, 389, 330), K(cueBeat("cut.oracle") - 0.9, 1.0),
    K(cueBeat("cut.oracle") + 0.2, 1.38, 941, 270), K(s("bell") - 0.4, 1.38, 941, 280), K(s("bell") - E, 1.38, 941, 280),
    // 05 · The bell
    K(s("bell", 0), 1.38, ...ORB), K(s("bell", 1.6), 1.2, 389, 380), K(s("bell", 2.7), 1.0), K(s("bell", 3.6), 1.32, 430, 110), K(s("bell", 8.4), 1.32, 430, 120),
    K(cueBeat("bell.split1") - 1.0, 1.0, 560, 380), K(s("payout") - E, 1.0, 560, 380),
    // 06 · Payout
    K(s("payout", 0), 1.15, 480, 290), K(cueBeat("payout.withdraw") - 0.3, 1.15, 480, 300), K(cueBeat("payout.sheet") + 0.3, 1.12, 520, 320),
    K(cueBeat("payout.approve") + 0.4, 1.12, 520, 320), K(cueBeat("payout.done") + 0.4, 1.25, 946, 190), K(cueBeat("payout.guard") + 1.2, 1.25, 946, 190),
    K(cueBeat("payout.guard") + 2.2, 1.0), K(s("payout", 12.8), 1.0), K(s("payout", 14.2), 1.22, 200, 380), K(s("host") - E, 1.22, 200, 380),
    // 07 · Host & creator
    K(s("host", 0), 1.22, 200, 380), K(s("host", 0.7), 1.0), K(cueBeat("host.panta") - 0.8, 1.28, 820, 250), K(cueBeat("host.pick") + 0.4, 1.28, 820, 330),
    K(cueBeat("host.create") + 0.6, 1.3, 820, 360), K(cueBeat("host.kit") - 0.1, 1.3, 820, 380), K(cueBeat("host.kit") + 0.6, 1.0), K(cueBeat("host.copy") - 1.4, 1.12, 640, 340),
    K(cueBeat("host.copy") + 0.4, 1.12, 700, 360), K(cueBeat("host.overlay") + 0.6, 0.86, undefined, undefined, { ay: 600 }), K(s("tech"), 0.82, undefined, undefined, { ay: 600 })
  ];
}
const KEYS = cameraKeys();

/** Decaying camera shake for the hits. */
function shake(beat: number): [number, number] {
  let x = 0, y = 0;
  for (const [b, amp] of [[cueBeat("cut.sting"), 14], [cueBeat("bell.ring"), 10], [cueBeat("trade.lock"), 5]] as const) {
    const t = beat - b;
    if (t < 0 || t > 1.4) continue;
    const e = Math.exp(-t * 4.5) * amp;
    x += Math.sin(t * 47) * e;
    y += Math.cos(t * 39) * e * 0.7;
  }
  return [x, y];
}

/** Which app screen fills the browser at a beat. */
function screenAt(beat: number): React.ReactNode {
  if (beat < at("problem")) {
    // The cover: a live round; on "solo sport" everyone else fades away.
    const lonely = prog(beat, cueBeat("intro.lonely"), 2.2);
    return <PitPage m={false} beat={beat} scroll={0} virtualBeat={at("trade", 17.4) + beat * 0.12} lonely={lonely} />;
  }
  if (beat < at("seat")) return <SigninScreen m={false} beat={beat} />;
  if (beat < cueBeat("host.next") + 0.5) {
    const payout = beat >= at("payout");
    const claim = beat < cueBeat("payout.withdraw") + 0.1 ? "ready" : beat < cueBeat("payout.done") ? "busy" : "done";
    return <PitPage m={false} beat={beat} showClaim={payout} claim={claim} hostAt={beat >= at("payout", 12.2) ? cueBeat("host.next") : undefined} />;
  }
  if (beat < cueBeat("host.kit")) return <HostPanelScreen m={false} beat={beat} />;
  return <HostScreen m={false} beat={beat} />;
}

const Screen: React.FC<{ beat: number }> = ({ beat }) => {
  const v = VIEW.landscape;
  const cuts: Array<[number, number]> = [[at("seat"), 0.16], [cueBeat("host.next") + 0.5, 0.2], [cueBeat("host.kit"), 0.25]];
  const hit = cuts.find(([c, h]) => Math.abs(beat - c) < h);
  const layer = (b: number, o: number) => (
    <div style={{ position: "absolute", inset: 0, opacity: o }}>
      <AppBg m={false} />
      {screenAt(b)}
      <DeviceOverlays m={false} beat={b} />
    </div>
  );
  if (hit) {
    const [near, half] = hit;
    const t = prog(beat, near - half, half * 2, (x) => x);
    return (
      <div style={{ position: "relative", width: v.w, height: v.h, overflow: "hidden" }}>
        {layer(Math.min(beat, near - 0.001), 1)}
        {layer(Math.max(beat, near), t)}
      </div>
    );
  }
  return <div style={{ position: "relative", width: v.w, height: v.h, overflow: "hidden" }}>{layer(beat, 1)}</div>;
};

/** "Only your signature releases funds" — the escrow guarantee, beside the payout. */
const GuardCallout: React.FC<{ beat: number }> = ({ beat }) => {
  const a = cueBeat("payout.guard");
  const p = prog(beat, a, 0.6, (t) => easeOutBack(t, 1.3));
  const out = prog(beat, at("payout", 12.4), 0.5);
  if (beat < a || out >= 1) return null;
  return (
    <div style={{
      position: "absolute", left: 1150, top: 760, width: 700, padding: "22px 26px", borderRadius: 22, display: "flex", gap: 18, alignItems: "center",
      background: "linear-gradient(180deg, rgba(23,29,44,0.97), rgba(12,15,22,0.97))", border: `1px solid ${rgba(C.up, 0.55)}`,
      boxShadow: `0 30px 80px rgba(0,0,0,0.55), 0 0 50px ${rgba(C.up, 0.18)}`, opacity: Math.min(1, p * 1.3) * (1 - out), transform: `translateY(${(1 - p) * 40}px)`
    }}>
      <svg width="54" height="54" viewBox="0 0 24 24" style={{ flexShrink: 0 }}><path d="M12 3l7 3v6c0 4.2-3 7.6-7 9-4-1.4-7-4.8-7-9V6z" fill={rgba(C.up, 0.12)} stroke={C.up} strokeWidth="1.8" strokeLinejoin="round" /><path d="M8.5 12l2.4 2.4L15.5 9.8" fill="none" stroke={C.up} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <div>
        <div style={{ fontFamily: F.text, fontWeight: 800, fontSize: 30, color: C.text, letterSpacing: -0.6 }}>Only your signature releases funds</div>
        <div style={{ fontFamily: F.text, fontWeight: 500, fontSize: 22, color: C.text2, marginTop: 4 }}>The operator records results. It can&apos;t move your USDC.</div>
      </div>
    </div>
  );
};

export const DemoFilm: React.FC = () => {
  const frame = useCurrentFrame();
  const beat = frameToBeat(frame);
  const cam = cameraAt("landscape", KEYS, beat);
  const [sx, sy] = shake(beat);
  cam.ax += sx;
  cam.ay += sy;
  const pulse = beatPulse(beat);

  // The browser leaves for the explainer slides and flies back in for the demo.
  const introOut = prog(beat, at("intro", 10.2), 1.5, (t) => t * t);
  const demoIn = prog(beat, at("signin") - 0.8, 1.1, easeOutQuint);
  const demoOut = prog(beat, at("tech") - 0.4, 0.5);
  const inIntro = beat < at("problem");
  const inDemo = beat >= at("signin") - 0.8 && beat < at("tech") + 0.1;
  const devP = inIntro ? 1 - introOut : inDemo ? demoIn : 0;
  const streamDim = prog(beat, cueBeat("host.overlay"), 0.8) * 0.85;
  const deviceOpacity = devP * (1 - streamDim) * (1 - demoOut);
  const deviceShift = inIntro ? introOut * 420 : (1 - demoIn) * 520;
  const url = beat < at("problem") ? `/a/${PIT.code}` : beat < at("seat") ? "" : beat < cueBeat("host.next") + 0.5 ? `/a/${PIT.code}` : beat < cueBeat("host.kit") ? "/?tab=host" : `/a/${PIT.hostedCode}`;
  const deviceSection = inIntro || (beat >= at("signin") && beat < at("tech"));

  const stingFlash = flashAt(beat, cueBeat("cut.sting"), 0.6);
  const bellFlash = flashAt(beat, cueBeat("bell.ring"), 0.8);
  const solFlash = flashAt(beat, at("solution"), 0.9);
  const outro = section("outro");
  const endFade = prog(beat, outro.endBeat - 1.2, 1.15);

  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <Backdrop layout="landscape" beat={beat} />
      {deviceOpacity > 0.01 && (
        <div style={{ position: "absolute", inset: 0, opacity: deviceOpacity, transform: `translateX(${deviceShift}px) scale(${1 - 0.06 * (inIntro ? introOut : 1 - demoIn)})`, transformOrigin: "66% 52%" }}>
          <DeviceRig layout="landscape" cam={cam} beat={beat}>
            <BrowserFrame url={url} glow={pulse * 0.4}><Screen beat={beat} /></BrowserFrame>
          </DeviceRig>
        </div>
      )}
      <StreamWindow layout="landscape" beat={beat} />
      {/* Scrim behind the captions so they stay readable over a pushed-in browser. */}
      {deviceSection && (() => {
        const zoomed = Math.min(1, Math.max(0, (cam.s / REST.landscape.scale - 1.08) / 0.25));
        return (
          <div style={{
            position: "absolute", inset: 0, pointerEvents: "none", opacity: inIntro ? 1 : demoIn,
            background: `linear-gradient(90deg, rgba(10,13,19,0.95) 0%, rgba(10,13,19,${0.88 + zoomed * 0.08}) ${27 + zoomed * 8}%, rgba(10,13,19,${0.4 + zoomed * 0.3}) ${33.5 + zoomed * 4}%, rgba(10,13,19,0) ${38 + zoomed * 5}%)`
          }} />
        );
      })()}
      <SplitCard layout="landscape" beat={beat} />
      <GuardCallout beat={beat} />
      <IntroLockup layout="landscape" beat={beat} />
      <ProblemSlide beat={beat} />
      <SolutionSlide beat={beat} />
      <AudienceSlide beat={beat} />
      <TechSlide beat={beat} />
      <FormatsSlide beat={beat} />
      {(["signin", "seat", "trade", "cut", "bell", "payout", "host"] as const).map((id) => (
        <Caption key={id} layout="landscape" beat={beat} id={id} />
      ))}
      <OutroLockup layout="landscape" beat={beat} />
      <Subtitles beat={beat} cx={deviceSection ? 1282 : 960} />
      <DevnetChip layout="landscape" />
      {/* Hit flashes */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", boxShadow: `inset 0 0 ${260 * stingFlash}px ${rgba(C.down, 0.55 * stingFlash)}` }} />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: `radial-gradient(circle at 40% 50%, ${rgba(C.gold, 0.35 * bellFlash)}, transparent 65%)` }} />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: `radial-gradient(circle at 50% 42%, ${rgba(C.neon, 0.5 * solFlash)}, transparent 60%)` }} />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "#000", opacity: endFade }} />
      <Audio src={staticFile("soundtrack.wav")} />
    </AbsoluteFill>
  );
};
