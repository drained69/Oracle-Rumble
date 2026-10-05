"use client";

import { Component, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { setPrivyFailed, X_REQUIRED } from "@/lib/privy-client";

// The Privy SDK is large: load it only on deployments that use X sign-in.
const PrivyRoot = dynamic(() => import("@/app/PrivyRoot"), { ssr: false });

// Privy sits in the root layout: if it fails to start, the rest of the site
// must keep working (X sign-in then reports itself unavailable).
class PrivyGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("X sign-in (Privy) failed to start:", error);
    setPrivyFailed();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function PrivyMount() {
  return X_REQUIRED ? <PrivyGuard><PrivyRoot /></PrivyGuard> : null;
}
