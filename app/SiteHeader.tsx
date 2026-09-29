"use client";

import type { ReactNode } from "react";
import { BrandMark, Wordmark } from "@/app/BrandMark";
import WalletPicker from "@/app/WalletPicker";
import { avatarDataUrl } from "@/lib/avatars";
import { shortPk } from "@/lib/username";
import type { EscrowStatus } from "@/lib/use-wallet";

export type NavKey = "arenas" | "host" | "positions" | "docs";

const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").toLowerCase();

const NAV: { key: NavKey; label: string; href: string }[] = [
  { key: "arenas", label: "Arenas", href: "/" },
  { key: "host", label: "Host", href: "/?tab=host" },
  { key: "positions", label: "Positions", href: "/positions" },
  { key: "docs", label: "Docs", href: "/docs" }
];

/** One header for every page: brand, nav, network mode, account. */
export default function SiteHeader({
  active,
  wallet,
  username,
  escrow,
  onConnect,
  onEditUsername,
  onNav,
  extra
}: {
  active: NavKey | null;
  wallet: string | null;
  username: string;
  escrow: EscrowStatus | null;
  onConnect: () => void;
  onEditUsername: () => void;
  /** Home page switches its Arenas/Host tabs in place instead of navigating. */
  onNav?: (key: "arenas" | "host") => void;
  extra?: ReactNode;
}) {
  const mode = escrow == null ? "…" : escrow.active ? "On-chain" : "Practice";
  const modeTitle = escrow == null
    ? "Checking escrow status"
    : escrow.active
      ? `Solana ${CLUSTER} · deposits and claims settle in a non-custodial escrow program`
      : `Solana ${CLUSTER} · practice mode (${escrow.reason ?? "escrow off"}) — no USDC moves`;

  return (
    <nav className="hud-bar game-hud" aria-label="Main">
      <div className="tabbar-inner">
        <a href="/" className="brand" aria-label="Oracle Rumble home">
          <BrandMark />
          <Wordmark />
        </a>

        <div className="hud-nav">
          {NAV.map((n) => (
            <a
              key={n.key}
              href={n.href}
              className={active === n.key ? "active" : undefined}
              aria-current={active === n.key ? "page" : undefined}
              onClick={(e) => {
                if (onNav && (n.key === "arenas" || n.key === "host")) {
                  e.preventDefault();
                  onNav(n.key);
                }
              }}
            >
              {n.label}
            </a>
          ))}
        </div>

        <div className="hud-right">
          <span className={`system-chip ${escrow?.active ? "on" : "off"}`} title={modeTitle}>
            <span className="dot" aria-hidden="true" />
            <span className="sc-net">{CLUSTER}</span>
            <span className="sc-mode">{mode}</span>
          </span>
          {extra}
          {wallet ? (
            <div className="acct">
              <button className={`acct-main ${username ? "" : "needs-name"}`} onClick={onEditUsername} title={username ? "Edit username" : "Set username"}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="acct-avatar" src={avatarDataUrl(wallet, 26)} width={26} height={26} alt="" />
                <span className="acct-text">
                  <span className={`acct-name ${username ? "" : "unset"}`}>{username || "Set username"}</span>
                  <span className="acct-pk">{shortPk(wallet)}</span>
                </span>
                {!username && <span className="acct-alert" aria-hidden="true" />}
              </button>
              <button className="acct-exit" onClick={onConnect} aria-label="Disconnect wallet" title="Disconnect">
                <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                  <path d="M12 3v8M6.3 6.8a8 8 0 1 0 11.4 0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ) : (
            <button className="acct-connect" onClick={onConnect}>Connect wallet</button>
          )}
        </div>
      </div>
      <WalletPicker />
    </nav>
  );
}
