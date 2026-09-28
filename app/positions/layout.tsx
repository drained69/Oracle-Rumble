import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Positions",
  description: "Your wallet's Panta market positions and claimable winnings."
};

export default function PositionsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
