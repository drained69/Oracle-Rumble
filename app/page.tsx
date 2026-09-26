import ArenasDirectory from "@/app/ArenasDirectory";

/**
 * Root — the arenas lobby. Lists every active user-hosted rumble, offers an
 * inline host card (Host & Join in one action), and a live BTC/ETH/SOL up/down
 * markets strip. To walk into a bot practice game go to `/play`.
 */
export default function Home() {
  return <ArenasDirectory />;
}
