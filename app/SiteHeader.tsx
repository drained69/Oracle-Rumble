"use client";

import type { ReactNode } from "react";
import { BrandMark, Wordmark } from "@/app/BrandMark";
import AccountMenu from "@/app/AccountMenu";
import { useWalletIdentity, type EscrowStatus } from "@/lib/use-wallet";

export type NavKey = "arenas" | "host" | "positions" | "docs";

const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").toLowerCase();

const NAV: { key: NavKey; label: string; href: string }[] = [
  { key: "arenas", label: "Pits", href: "/" },
  { key: "host", label: "Host", href: "/?tab=host" },
  { key: "positions", label: "Positions", href: "/positions" },
  { key: "docs", label: "Docs", href: "/docs" }
];

/** The X logo, for "Sign in with X". */
export function XLogo({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M13.6 10.7 18.9 4.5h-1.3l-4.6 5.4-3.7-5.4H5l5.6 8.1L5 19.5h1.3l4.9-5.7 3.9 5.7h4.3l-5.8-8.8Zm-1.7 2-.6-.8-4.5-6.4h1.9l3.6 5.2.6.8 4.7 6.7h-1.9l-3.8-5.5Z" />
    </svg>
  );
}

/** One header for every page: brand, nav, network mode, and the X account. */
export default function SiteHeader({
  active,
  escrow,
  onToast,
  onNav,
  extra
}: {
  active: NavKey | null;
  escrow: EscrowStatus | null;
  /** Where sign-in/out messages go. */
  onToast: (msg: string) => void;
  /** Home page switches its Pits/Host tabs in place instead of navigating. */
  onNav?: (key: "arenas" | "host") => void;
  extra?: ReactNode;
}) {
  const { wallet, username, status, signIn, signOut } = useWalletIdentity();
  const mode = escrow == null ? "…" : escrow.active ? "On-chain" : "Practice";
  const modeTitle = escrow == null
    ? "Checking escrow status"
    : escrow.active
      ? `Solana ${CLUSTER} · deposits and claims settle in a non-custodial escrow program`
      : `Solana ${CLUSTER} · practice mode (${escrow.reason ?? "escrow off"}) — no USDC moves`;

  return (
    <nav className="hud-bar game-hud" aria-label="Main">
      <div className="tabbar-inner">
        <a href="/" className="brand" aria-label="The Pit home">
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
            <AccountMenu
              wallet={wallet}
              username={username}
              busy={status === "busy"}
              onSignOut={async () => onToast((await signOut()).message)}
              onToast={onToast}
            />
          ) : (
            <button
              className="acct-connect"
              onClick={async () => { const r = await signIn(); if (r.message) onToast(r.message); }}
              disabled={status === "busy" || status === "loading"}
              aria-busy={status === "busy"}
            >
              <XLogo /> {status === "busy" ? "Signing in…" : "Sign in with X"}
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
