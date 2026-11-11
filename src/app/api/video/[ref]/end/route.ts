import { NextResponse } from "next/server";
import { SAME_ORIGIN_ERROR, isSameOriginMutation } from "@/lib/security/origin";
import { endCall, validCall } from "@/modules/video/service";

/** A host ends the call for everyone (the LiveKit room is deleted). Body: { organizationId }. */
export async function POST(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  // Same origin rule as the other cookie-authenticated mutations. The call page posts here.
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: SAME_ORIGIN_ERROR }, { status: 403 });
  const { ref } = await params;
  const body = (await request.json().catch(() => null)) as { organizationId?: unknown } | null;
  const organizationId = body?.organizationId;
  if (!validCall(organizationId, ref)) return NextResponse.json({ error: "Choose the call." }, { status: 400 });
  const result = await endCall(organizationId, ref);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
