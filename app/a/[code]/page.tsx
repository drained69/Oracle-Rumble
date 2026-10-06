import type { Metadata } from "next";
import ArenaView from "@/app/ArenaView";
import { normalizeArenaCode } from "@/lib/royale";

type Params = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const code = normalizeArenaCode((await params).code);
  return {
    title: `Pit ${code}`,
    description: `Join pit ${code} on The Pit — take a seat, trade the live odds, finish on top.`
  };
}

/**
 * `/a/{code}` — a specific arena's room, the link players share. Hosted
 * arenas don't auto-restart; a finished room shows its final board.
 */
export default async function ArenaRoom({ params }: Params) {
  const { code } = await params;
  return <ArenaView arenaCode={normalizeArenaCode(code)} />;
}
