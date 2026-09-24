import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Oracle Rumble — call it, prove it, climb",
  description: "Prediction-market arenas where hunches enter the ring. Powered by Panta."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
