import { NextResponse } from "next/server";
import { joinCall, validCall } from "@/modules/video/service";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * A LiveKit join token for the signed-in person (BUILD-SPEC §7.3). The database decides who and
 * when (public.video_join); the token is in this answer only and is never logged or stored.
 * Body: { organizationId }.
 */
export async function POST(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const body = (await request.json().catch(() => null)) as { organizationId?: unknown } | null;
  const organizationId = body?.organizationId;
  if (!validCall(organizationId, ref)) return NextResponse.json({ error: "Choose the call." }, { status: 400, headers: NO_STORE });
  const result = await joinCall(organizationId, ref);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status, headers: NO_STORE });
  if (!result.grant) {
    // Not open (early, closed, cancelled) or video isn't set up: what the call is, and no token.
    return NextResponse.json({ view: { ...result.view, grant: null }, configured: result.configured }, { headers: NO_STORE });
  }
  return NextResponse.json(
    {
      serverUrl: result.grant.serverUrl,
      token: result.grant.token,
      identity: result.grant.identity,
      role: result.grant.role,
      admitted: result.grant.admitted,
    },
    { headers: NO_STORE },
  );
}
