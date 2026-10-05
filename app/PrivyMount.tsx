"use client";

import dynamic from "next/dynamic";
import { X_REQUIRED } from "@/lib/privy-client";

// The Privy SDK is large: load it only on deployments that use X sign-in.
const PrivyRoot = dynamic(() => import("@/app/PrivyRoot"), { ssr: false });

export default function PrivyMount() {
  return X_REQUIRED ? <PrivyRoot /> : null;
}
