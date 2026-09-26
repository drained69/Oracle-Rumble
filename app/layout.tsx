import type { Metadata } from "next";
import PriceTicker from "@/app/PriceTicker";
import "./globals.css";

export const metadata: Metadata = {
  title: "Oracle Rumble — call it, prove it, climb",
  description: "Prediction-market arenas where hunches enter the ring. Powered by Panta."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {/* Live BTC / ETH / SOL ticker — always at the very top. */}
        <PriceTicker />
        {children}
      </body>
    </html>
  );
}
