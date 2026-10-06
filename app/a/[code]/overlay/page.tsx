import type { Metadata } from "next";
import PitOverlay from "@/app/PitOverlay";
import { normalizeArenaCode } from "@/lib/royale";

type Params = { params: Promise<{ code: string }>; searchParams: Promise<{ bg?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const code = normalizeArenaCode((await params).code);
  return { title: `Pit ${code} · stream overlay`, robots: { index: false } };
}

/**
 * `/a/{code}/overlay` — a read-only live view of a pit for a stream's browser
 * source (OBS / Streamlabs, 1280×720). Transparent by default; `?bg=solid`
 * paints the app background.
 */
export default async function Overlay({ params, searchParams }: Params) {
  const code = normalizeArenaCode((await params).code);
  const solid = (await searchParams).bg === "solid";
  return <PitOverlay arenaCode={code} solid={solid} />;
}
