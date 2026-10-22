import { NextResponse } from "next/server";
import { endCall, validCall } from "@/modules/video/service";

/** A host ends the call for everyone (the LiveKit room is deleted). Body: { organizationId }. */
export async function POST(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const body = (await request.json().catch(() => null)) as { organizationId?: unknown } | null;
  const organizationId = body?.organizationId;
  if (!validCall(organizationId, ref)) return NextResponse.json({ error: "Choose the call." }, { status: 400 });
  const result = await endCall(organizationId, ref);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
