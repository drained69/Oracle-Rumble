import ArenaView from "@/app/ArenaView";
import { PUBLIC_ARENA } from "@/lib/royale";

/**
 * Root — the walk-in PUBLIC arena. Always has a live round (auto-bootstraps
 * when empty). Users can also click "Host a rumble" to mint their own arena
 * and get a shareable `/a/{code}` link.
 */
export default function Home() {
  return <ArenaView arenaCode={PUBLIC_ARENA} />;
}
