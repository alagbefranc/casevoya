import { NextResponse } from "next/server";
import { databaseReachable, healthBody } from "@/lib/health";

/**
 * Uptime probe. No session, no rate limit, no secrets and no personal data in the body.
 * The proxy skips the auth redirect for this path. 200 when PostgREST answers, 503 when
 * it does not. Cache-Control is no-store so a monitor never reuses an old answer.
 */
export async function GET() {
  const time = new Date().toISOString();
  const reachable = await databaseReachable();
  return NextResponse.json(healthBody(reachable, time), {
    status: reachable ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
