import React from "react";
import { countUp, keyframes, prog, usd2 } from "../anim";
import { STATUS_BAR, VIEW } from "../device";
import { F } from "../fonts";
import { C, rgba } from "../theme";
import { ME, MY_NET, PIT, R1_FINAL, SEAT, USDC_AFTER, at, cueBeat } from "../timeline";
import { Avatar, XLogo } from "../ui/brand";
import { Header } from "../ui/Header";
import { CheckIcon, LockIcon, Notice, WalletIcon } from "../ui/kit";
import { HostPanel } from "../ui/HostPanel";
import { Lobby } from "../ui/Lobby";
import { CreatorKit } from "../ui/pit/CreatorKit";
import { RoundBar } from "../ui/pit/RoundBar";
import { SeatModal, WalletSheet, type SeatStep } from "../ui/pit/SeatModal";
import { clock, lockSecAt } from "./common";

/** The page background of the app (body + .game-grid-bg). */
export const AppBg: React.FC<{ m: boolean }> = ({ m }) => {
  const v = VIEW[m ? "portrait" : "landscape"];
  return (
    <div style={{
      position: "absolute", inset: 0, width: v.w, height: v.h,
      background: "radial-gradient(1200px 800px at 8% -10%, rgba(192,132,252,0.16), transparent 60%), radial-gradient(900px 700px at 100% 4%, rgba(56,189,248,0.10), transparent 55%), #0a0d13"
    }}>
      <div style={{
        position: "absolute", inset: 0, opacity: 0.6,
        backgroundImage: "linear-gradient(rgba(192,132,252,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(192,132,252,0.045) 1px, transparent 1px)",
        backgroundSize: "44px 44px"
      }} />
    </div>
  );
};

/** 01 — the lobby, signed out → signed in → the live pits directory. */
export const SigninScreen: React.FC<{ m: boolean; beat: number }> = ({ m, beat }) => {
  const s = at("signin");
  const tap = cueBeat("signin.tap");
  const done = cueBeat("signin.done");
  const account = prog(beat, done - 0.15, 0.4);
  const loaded = prog(beat, cueBeat("signin.done") + 1.4, 0.6);
  const sy = m ? keyframes(beat, [[cueBeat("signin.scroll"), 0], [cueBeat("signin.scroll") + 1, 352]]) : 0;
  const ring = cueBeat("signin.ring");
  return (
    <div style={{ position: "absolute", inset: 0, transform: `translateY(${-sy}px)` }}>
      {m && <div style={{ height: STATUS_BAR }} />}
      <Header m={m} beat={beat} account={account} signing={beat >= tap && beat < done} tapAt={tap} />
      <Lobby m={m} beat={beat} loaded={loaded} statsP={prog(beat, s + 0.3, 3, (t) => 1 - Math.pow(1 - t, 3))} seats={5}
        lockSec={lockSecAt(beat)} takeSeatAt={cueBeat("signin.takeSeat")} ringPulse={beat > ring ? 1 - prog(beat, ring, 0.9) : 0} />
    </div>
  );
};

/** 07 — the lobby's Host tab: pick a Panta market, or write a new one. */
export const HostPanelScreen: React.FC<{ m: boolean; beat: number }> = ({ m, beat }) => {
  const pantaAt = cueBeat("host.panta");
  const createAt = cueBeat("host.create");
  const source = beat < pantaAt + 0.05 ? "crypto" : beat < createAt + 0.05 ? "panta" : "create";
  const q = PIT.hostedQuestion;
  const typeFrom = createAt + 0.4, typeTo = cueBeat("host.kit") - 0.6;
  const typed = q.slice(0, Math.max(0, Math.min(q.length, Math.floor(((beat - typeFrom) / (typeTo - typeFrom)) * q.length))));
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Header m={m} beat={beat} account={1} active="host" />
      <Lobby m={m} beat={beat} loaded={1} statsP={1} seats={5} lockSec={80} takeSeatAt={-99}
        host={<HostPanel beat={beat} source={source} picked={beat >= cueBeat("host.pick") ? 0 : null} typed={typed} pantaAt={pantaAt} pickAt={cueBeat("host.pick")} createAt={createAt} />} />
    </div>
  );
};

/** 07 — the host's new pit with the creator kit. */
export const HostScreen: React.FC<{ m: boolean; beat: number }> = ({ m, beat }) => {
  const copied = beat >= cueBeat("host.copy") ? 1 : 0;
  // On the phone, scroll the QR into view while the stream preview takes the top of the frame.
  const sy = m ? keyframes(beat, [[cueBeat("host.overlay") - 0.2, 0], [cueBeat("host.overlay") + 0.8, 196]]) : 0;
  return (
    <div style={{ position: "absolute", inset: 0, transform: `translateY(${-sy}px)` }}>
      {m && <div style={{ height: STATUS_BAR }} />}
      <Header m={m} beat={beat} account={1} arenaCode={PIT.hostedCode} active="host" />
      <RoundBar m={m} round={1} status="enrolling" clockLabel="Locks in" clock={clock(keyframes(beat, [[at("host"), 120], [at("tech"), 112]], (t) => t))}
        pool={PIT.entry} alive={1} total={1} yes={58} line={58} question={PIT.hostedQuestion} category="sports" />
      <div style={{ position: "absolute", left: m ? 10 : 14, right: m ? 10 : 14, top: m ? 228 : 142 }}>
        <CreatorKit m={m} beat={beat} copyAt={cueBeat("host.copy")} copied={copied} qrReveal={prog(beat, cueBeat("host.kit") + 0.3, 1.2, (t) => t)} />
      </div>
    </div>
  );
};

/** The account panel (app/AccountMenu.tsx) with the balance landing. */
const AccountPanel: React.FC<{ m: boolean; beat: number; p: number }> = ({ m, beat, p }) => {
  const done = cueBeat("payout.done");
  const usdc = beat < done ? PIT.usdcBefore - SEAT : countUp(beat, done + 0.2, 1.6, PIT.usdcBefore - SEAT, USDC_AFTER);
  const flash = beat >= done ? 1 - prog(beat, done + 0.2, 2) : 0;
  return (
    <div style={{
      position: "absolute", right: m ? 10 : 14, top: m ? STATUS_BAR + 64 : 70, width: m ? 300 : 320, zIndex: 70, opacity: p, transform: `translateY(${(1 - p) * -14}px)`,
      borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 12,
      background: "linear-gradient(180deg, #171d2c, #0f131b)", border: `1px solid ${rgba(C.up, 0.4)}`, boxShadow: `0 24px 60px rgba(0,0,0,0.6), 0 0 ${30 * flash}px ${rgba(C.up, 0.4 * flash)}`
    }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Avatar seed={ME.seed} size={38} radius={10} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontFamily: F.text, fontWeight: 800, fontSize: 14, color: C.text }}>@{ME.name}</span>
          <span style={{ fontFamily: F.text, fontSize: 11.5, color: C.text3 }}>Signed in with X</span>
        </div>
      </div>
      <div>
        <div style={{ fontFamily: F.mono, fontSize: 9.5, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: C.text3 }}>
          Your Solana wallet <span style={{ color: C.amber }}>devnet</span>
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 12, color: C.text2, marginTop: 4 }}>{PIT.walletShort}</div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1, padding: "8px 10px", borderRadius: 10, background: rgba(C.up, 0.08 + flash * 0.12), border: `1px solid ${rgba(C.up, 0.35)}` }}>
          <div style={{ fontFamily: F.mono, fontSize: 9.5, fontWeight: 700, letterSpacing: 1.2, color: C.text3 }}>USDC</div>
          <div style={{ fontFamily: F.mono, fontWeight: 800, fontSize: 20, color: C.text }}>{usdc.toFixed(2)}</div>
        </div>
        <div style={{ flex: 1, padding: "8px 10px", borderRadius: 10, background: "rgba(10,13,19,0.6)", border: `1px solid ${C.border}` }}>
          <div style={{ fontFamily: F.mono, fontSize: 9.5, fontWeight: 700, letterSpacing: 1.2, color: C.text3 }}>SOL</div>
          <div style={{ fontFamily: F.mono, fontWeight: 800, fontSize: 20, color: C.text }}>0.0480</div>
        </div>
      </div>
    </div>
  );
};

const Backdrop: React.FC<{ p: number }> = ({ p }) => (
  <div style={{ position: "absolute", inset: 0, background: `rgba(4,6,10,${0.62 * p})`, backdropFilter: `blur(${3 * p}px)`, zIndex: 40 }} />
);

/** Everything that floats over the page: notifications, the seat modal, wallet approvals. */
export const DeviceOverlays: React.FC<{ m: boolean; beat: number }> = ({ m, beat }) => {
  const top = m ? STATUS_BAR + 6 : 12;
  const els: React.ReactNode[] = [];

  // 01
  els.push(<Notice key="openx" m={m} top={top} beat={beat} from={cueBeat("signin.tap") + 0.2} to={cueBeat("signin.done") - 0.1} tone="plasma"
    icon={<XLogo size={16} />} title="Opening X…" />);
  els.push(<Notice key="signedin" m={m} top={top} beat={beat} from={cueBeat("signin.done")} to={cueBeat("signin.done") + 3.4} tone="up"
    icon={<CheckIcon size={18} />} title={`Signed in as @${ME.name}.`} sub={<>Your Solana wallet · devnet · <span style={{ fontFamily: F.mono }}>{PIT.walletShort}</span></>} />);

  // 02 — modal + wallet approval
  const modalIn = prog(beat, cueBeat("seat.modal"), 0.45);
  const modalOut = prog(beat, cueBeat("seat.seated") - 0.35, 0.35);
  const modalP = modalIn * (1 - modalOut);
  if (beat >= at("seat") && beat < at("trade") && modalP > 0) {
    const approve = cueBeat("seat.approve");
    const step: SeatStep = beat < cueBeat("seat.deposit") + 0.1 ? "" : beat < approve + 0.15 ? "approve" : beat < cueBeat("seat.confirming") + 0.75 ? "confirming" : "seating";
    const sheetP = prog(beat, cueBeat("seat.sheet"), 0.4) * (1 - prog(beat, approve + 0.45, 0.3));
    els.push(<Backdrop key="bd" p={modalP} />);
    els.push(
      <div key="seatmodal" style={{
        position: "absolute", left: "50%", top: m ? STATUS_BAR + 26 : 30, zIndex: 45, opacity: modalP,
        transform: `translate(-50%, ${(1 - modalIn) * 60 + modalOut * 30}px) scale(${0.96 + 0.04 * modalIn})`
      }}>
        <SeatModal m={m} beat={beat} picked={beat >= cueBeat("seat.yes")} yesAt={cueBeat("seat.yes")} depositAt={cueBeat("seat.deposit")} step={step} lockIn={clock(lockSecAt(beat))} entryAt={cueBeat("seat.entry")} vaultAt={cueBeat("seat.vault")} />
      </div>
    );
    if (sheetP > 0) {
      els.push(<div key="sheetbd" style={{ position: "absolute", inset: 0, background: `rgba(4,6,10,${0.45 * sheetP})`, zIndex: 46 }} />);
      els.push(
        <div key="sheet" style={{ position: "absolute", left: "50%", top: m ? 250 : 210, zIndex: 47, opacity: sheetP, transform: `translate(-50%, ${(1 - sheetP) * 40}px)` }}>
          <WalletSheet m={m} beat={beat} action="Seat deposit" amount={`${usd2(SEAT)} USDC`} to="Non-custodial USDC escrow" approveAt={approve} done={beat >= approve + 0.1} />
        </div>
      );
    }
  }
  els.push(<Notice key="dep" m={m} top={top} beat={beat} from={cueBeat("seat.deposit") + 0.25} to={cueBeat("seat.confirming")} tone="plasma"
    icon={<WalletIcon size={17} />} title={`Approve the ${usd2(SEAT)} seat deposit in your X wallet · opening call YES.`} />);
  els.push(<Notice key="conf" m={m} top={top} beat={beat} from={cueBeat("seat.confirming")} to={cueBeat("seat.seated")} tone="plasma"
    icon={<LockIcon size={16} />} title="Deposit sent — confirming on Solana…" />);
  els.push(<Notice key="in" m={m} top={top} beat={beat} from={cueBeat("seat.seated")} to={cueBeat("seat.seated") + 2.6} tone="neon"
    icon={<CheckIcon size={18} />} title="You're in." sub="Hidden until trading opens — seat calls stay secret while the pit fills." />);

  // 03
  els.push(<Notice key="lock" m={m} top={top} beat={beat} from={cueBeat("trade.lockNote")} to={at("trade", 3.7)} tone="plasma"
    icon={<LockIcon size={16} />} title={`Panta's line opened at ${PIT.line}¢ YES`} sub="The room trades its own odds from here." />);

  // 04
  els.push(<Notice key="settled" m={m} top={top} beat={beat} from={cueBeat("cut.sting")} to={cueBeat("cut.round2") - 0.1} tone="down"
    icon={<span style={{ fontFamily: F.display, fontWeight: 900, fontSize: 12 }}>✕</span>} title="Round 1 settled — 4 advance, 4 eliminated." />);
  els.push(<Notice key="r2" m={m} top={top} beat={beat} from={cueBeat("cut.round2")} to={cueBeat("cut.oracle") - 0.1} tone="neon"
    icon={<span style={{ fontFamily: F.display, fontWeight: 900, fontSize: 13 }}>2</span>} title="Round 2 begins"
    sub={<>Survivors carry their vault forward · yours <b style={{ fontFamily: F.mono, color: C.text }}>{usd2(R1_FINAL.find((x) => x.id === "me")!.vault)}</b></>} />);

  // 06 — withdraw approval + balance
  const ap = cueBeat("payout.approve");
  const wsP = prog(beat, cueBeat("payout.sheet"), 0.4) * (1 - prog(beat, ap + 0.45, 0.3));
  if (beat >= at("payout") && wsP > 0) {
    els.push(<div key="wsbd" style={{ position: "absolute", inset: 0, background: `rgba(4,6,10,${0.5 * wsP})`, zIndex: 46 }} />);
    els.push(
      <div key="ws" style={{ position: "absolute", left: "50%", top: m ? 250 : 200, zIndex: 47, opacity: wsP, transform: `translate(-50%, ${(1 - wsP) * 40}px)` }}>
        <WalletSheet m={m} beat={beat} action="Withdraw from escrow" amount={`${usd2(MY_NET)} USDC`} to={`@${ME.name} · ${PIT.walletShort}`} approveAt={ap} done={beat >= ap + 0.1} />
      </div>
    );
  }
  const accP = prog(beat, cueBeat("payout.done") - 0.1, 0.4) * (1 - prog(beat, at("payout", 11.4), 0.4));
  if (accP > 0) els.push(<AccountPanel key="acct" m={m} beat={beat} p={accP} />);

  // 07
  els.push(<Notice key="copied" m={m} top={top} beat={beat} from={cueBeat("host.copied")} to={cueBeat("host.overlay")} tone="plasma"
    icon={<CheckIcon size={18} />} title="Overlay URL copied." />);

  return <>{els}</>;
};
