import { NextResponse } from "next/server";
import { getPublicSlots } from "@/modules/scheduling/public-api";
import { publicDeps } from "@/modules/scheduling/public-deps";

/** Encoded UTC slot starts: first value is minutes since the epoch, then minute deltas. */
export async function GET(request: Request, { params }: { params: Promise<{ firm: string; event: string }> }) {
  const { firm, event } = await params;
  const search = new URL(request.url).searchParams;
  try {
    const result = await getPublicSlots(await publicDeps(), firm.toLowerCase(), event.toLowerCase(), {
      from: search.get("from"),
      to: search.get("to"),
      tz: search.get("tz"),
    });
    return NextResponse.json(result.body, { status: result.status, headers: result.headers });
  } catch {
    return NextResponse.json({ error: "unavailable", message: "Times couldn’t be loaded. Try again." }, { status: 502 });
  }
}
