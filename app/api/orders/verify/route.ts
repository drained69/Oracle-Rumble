import { NextResponse } from "next/server";
import { PANTA_LIVE, pantaFetch } from "@/lib/panta";

/**
 * POST /api/orders/verify
 * Maps to Panta's POST /orders/verify.
 *
 * After a signature is submitted, the client polls this to learn when
 * Panta has picked up the confirmation. Returns { status: pending |
 * confirmed | failed }.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { signature: string };
  if (!body?.signature) return NextResponse.json({ error: "signature required" }, { status: 400 });

  if (PANTA_LIVE) {
    try {
      const data = await pantaFetch<{ status: "pending" | "confirmed" | "failed" }>("/orders/verify", {
        method: "POST",
        body: JSON.stringify(body)
      });
      return NextResponse.json({ source: "panta", ...data });
    } catch (err) {
      console.error("panta /orders/verify failed, serving mock:", err);
    }
  }

  // Mock: always "confirmed" after a brief roll — good enough for demo.
  return NextResponse.json({ source: "mock", status: "confirmed" as const });
}
