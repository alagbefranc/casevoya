import { NextResponse } from "next/server";
import { admitToCall, validCall } from "@/modules/video/service";

/**
 * A host lets a waiting client in, or sends them away (BUILD-SPEC §7.4).
 * Body: { organizationId, identity, admit }.
 */
export async function POST(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const body = (await request.json().catch(() => null)) as { organizationId?: unknown; identity?: unknown; admit?: unknown } | null;
  const organizationId = body?.organizationId;
  if (!validCall(organizationId, ref) || typeof body?.identity !== "string" || typeof body?.admit !== "boolean") {
    return NextResponse.json({ error: "Choose who to let in." }, { status: 400 });
  }
  const result = await admitToCall(organizationId, ref, body.identity, body.admit);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
