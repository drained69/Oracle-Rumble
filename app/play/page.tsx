import ArenaView from "@/app/ArenaView";
import { PUBLIC_ARENA } from "@/lib/royale";

/**
 * `/play` — the walk-in PUBLIC practice arena. Always auto-bootstraps a bot
 * round so anyone can jump in and try the mechanics. The lobby at `/` is
 * where users find hosted rooms; this is the "practice against bots" door.
 */
export default function Play() {
  return <ArenaView arenaCode={PUBLIC_ARENA} />;
}
