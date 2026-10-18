import { NextResponse } from "next/server";
import { clientHash, postPublicHold } from "@/modules/scheduling/public-api";
import { clientAddress, publicDeps } from "@/modules/scheduling/public-deps";

/**
 * Books a free consultation (BUILD-SPEC §3 "hold"; PRD API "reserve capacity atomically and confirm
 * timezone"). The start is re-checked here, then the database re-checks it and takes the slot under
 * the exclusion constraint, and the confirmation email is queued in the outbox in that transaction.
 * Abuse checks: honeypot field, minimum time on the form, and a per-address and per-firm limit in
 * the database (the address is stored only as a hash).
 */
export async function POST(request: Request, { params }: { params: Promise<{ firm: string; event: string }> }) {
  const { firm, event } = await params;
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    return NextResponse.json({ error: "invalid", message: "Send the form as JSON." }, { status: 415 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid", message: "Check the form and try again." }, { status: 400 });
  }
  try {
    const hash = await clientHash(clientAddress(request.headers), process.env.BOOKING_CLIENT_SALT ?? "");
    const result = await postPublicHold(await publicDeps(), firm.toLowerCase(), event.toLowerCase(), body, hash);
    return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store", ...result.headers } });
  } catch {
    return NextResponse.json({ error: "unavailable", message: "The booking couldn’t be saved. Try again." }, { status: 502 });
  }
}
