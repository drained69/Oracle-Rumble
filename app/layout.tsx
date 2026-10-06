import type { Metadata, Viewport } from "next";
import "./globals.css";
import PrivyMount from "@/app/PrivyMount";

const DESCRIPTION =
  "Trading pits on any prediction market. Host a pit on tonight's game, a creator's question or live BTC, ETH and SOL — everyone takes the same seat, the room trades its own odds, Panta resolves the market and the best vaults split the pool. Non-custodial USDC escrow on Solana.";

export const metadata: Metadata = {
  title: { default: "The Pit — trading pits on any prediction market", template: "%s · The Pit" },
  description: DESCRIPTION,
  applicationName: "The Pit",
  openGraph: {
    type: "website",
    siteName: "The Pit",
    title: "The Pit — trading pits on any prediction market",
    description: DESCRIPTION
  },
  twitter: {
    card: "summary",
    title: "The Pit — trading pits on any prediction market",
    description: DESCRIPTION
  }
};

export const viewport: Viewport = {
  themeColor: "#0a0d13",
  colorScheme: "dark"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <PrivyMount />
      </body>
    </html>
  );
}
