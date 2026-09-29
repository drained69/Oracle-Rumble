import { NextResponse } from "next/server";

/**
 * Fixed-window, in-memory rate limits (the app runs as one instance). Keys
 * are per bucket + client, e.g. per IP or per wallet. Server-only.
 */
const _g = globalThis as unknown as { __or_rl?: Map<string, { start: number; n: number }> };
const hits: Map<string, { start: number; n: number }> = (_g.__or_rl ??= new Map());

export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "?";
}

/** True when `key` has used up `max` calls in the current `windowMs`. */
export function overLimit(bucket: string, key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (hits.size > 20_000) for (const [k, v] of hits) if (now - v.start > 3_600_000) hits.delete(k);
  const id = `${bucket}|${key}`;
  const h = hits.get(id);
  if (!h || now - h.start > windowMs) { hits.set(id, { start: now, n: 1 }); return false; }
  h.n += 1;
  return h.n > max;
}

/** 429 response when the caller's IP is over the limit for `bucket`, else null. */
export function limitByIp(request: Request, bucket: string, max: number, windowMs: number): NextResponse | null {
  return overLimit(bucket, clientIp(request), max, windowMs)
    ? NextResponse.json({ error: "Too many requests — slow down and try again in a minute." }, { status: 429 })
    : null;
}
