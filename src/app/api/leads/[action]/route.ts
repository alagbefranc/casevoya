import { NextResponse } from "next/server";
import { isLeadAction, runLeadAction } from "@/modules/leads/actions";

/**
 * The Lead pipeline and lead page writes (`/api/leads/move`, `/api/leads/convert`, …). JSON in,
 * JSON out. The database functions decide every write as the signed-in staff member; a stale
 * version comes back as 409 so the board can put a card back where it was.
 */
export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (!isLeadAction(action)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  const result = await runLeadAction(action, body);
  if ("error" in result) {
    const status = result.error === "Sign in first." ? 401 : result.conflict ? 409 : 400;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}
