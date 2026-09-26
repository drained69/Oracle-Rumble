import ArenaView from "@/app/ArenaView";
import { normalizeArenaCode } from "@/lib/royale";

/**
 * `/a/{code}` — a specific arena's room. The invite link users share with
 * friends. Hosted arenas don't auto-bootstrap; when a room's rumble finishes,
 * this page shows the final board briefly then goes empty (with a Host CTA).
 */
export default async function ArenaRoom({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <ArenaView arenaCode={normalizeArenaCode(code)} />;
}
