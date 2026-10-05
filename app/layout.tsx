import type { Metadata, Viewport } from "next";
import "./globals.css";
import PrivyMount from "@/app/PrivyMount";

const DESCRIPTION =
  "A prediction-market battle royale on Solana. Equal seats, UP or DOWN calls on live BTC, ETH and SOL prices, the bottom half cut each round — survivors split the pool. Non-custodial USDC escrow.";

export const metadata: Metadata = {
  title: { default: "Oracle Rumble — prediction-market battle royale", template: "%s · Oracle Rumble" },
  description: DESCRIPTION,
  applicationName: "Oracle Rumble",
  openGraph: {
    type: "website",
    siteName: "Oracle Rumble",
    title: "Oracle Rumble — prediction-market battle royale",
    description: DESCRIPTION
  },
  twitter: {
    card: "summary",
    title: "Oracle Rumble — prediction-market battle royale",
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
