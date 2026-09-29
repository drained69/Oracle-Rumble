import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Per-IP budget so the endpoint can't be used to flood the logs. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const _g = globalThis as unknown as { __or_clientLog?: Map<string, { start: number; n: number }> };

const clean = (v: unknown, max = 200) => String(v ?? "").replace(/[\r\n\t]+/g, " ").replace(/[^\x20-\x7e…—·]/g, "").slice(0, max);

/**
 * POST /api/client-log { event, wallet?, walletName?, action?, message?, ms? }
 *
 * Wallet steps happen in the browser, where the server can't see them. The
 * wallet module reports failures and slow prompts here so they show up in
 * the server logs. Public data only — never keys, signatures or messages.
 */
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";
  const hits = (_g.__or_clientLog ??= new Map());
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.start > WINDOW_MS) hits.set(ip, { start: now, n: 1 });
  else if (++h.n > MAX_PER_WINDOW) return new NextResponse(null, { status: 204 });
  if (hits.size > 5_000) hits.clear();

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  console.log(
    `[client] ${clean(b.event, 40)} wallet=${clean(b.wallet, 44)} via=${clean(b.walletName, 30)} ` +
    `action=${clean(b.action, 40)} ms=${Number(b.ms) || 0} page=${clean(b.page, 60)} :: ${clean(b.message)}`
  );
  return new NextResponse(null, { status: 204 });
}
