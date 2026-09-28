import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Docs",
  description: "How Oracle Rumble works: game rules, seats and payouts, the non-custodial escrow, Panta integration and the API."
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
