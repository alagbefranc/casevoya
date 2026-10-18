import { NextResponse } from "next/server";
import { getPublicEvent } from "@/modules/scheduling/public-api";
import { publicDeps } from "@/modules/scheduling/public-deps";

/** The published booking type (BUILD-SPEC §3). No staff names, no attendee data. */
export async function GET(_request: Request, { params }: { params: Promise<{ firm: string; event: string }> }) {
  const { firm, event } = await params;
  try {
    const result = await getPublicEvent(await publicDeps(), firm.toLowerCase(), event.toLowerCase());
    return NextResponse.json(result.body, { status: result.status, headers: result.headers });
  } catch {
    return NextResponse.json({ error: "unavailable", message: "This booking page couldn’t be loaded." }, { status: 502 });
  }
}
