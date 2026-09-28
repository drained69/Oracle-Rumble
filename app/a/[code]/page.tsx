import type { Metadata } from "next";
import ArenaView from "@/app/ArenaView";
import { normalizeArenaCode } from "@/lib/royale";

type Params = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const code = normalizeArenaCode((await params).code);
  return {
    title: `Arena ${code}`,
    description: `Join arena ${code} on Oracle Rumble — take a seat, trade the live market, survive the cut.`
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
