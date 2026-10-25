import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/tenant/context";
import { privacyResponseError } from "@/modules/compliance/privacy-response-format";

function refuse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/**
 * SEC-06 "Preview package": a 60-second signed link to a built privacy response for the staff who
 * work the request, after public.authorize_privacy_response_preview (fresh step-up, audited). A
 * staff preview is never the person's delivery proof.
 */
export async function POST(request: Request, { params }: { params: Promise<{ responseId: string }> }) {
  const { responseId } = await params;
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return refuse("This request must come from Casevoya.", 403);
  const body = (await request.json().catch(() => null)) as { organizationId?: unknown } | null;
  const organizationId = typeof body?.organizationId === "string" ? body.organizationId : "";
  if (!isUuid(responseId) || !isUuid(organizationId)) return refuse("Choose the package.", 400);
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return refuse("Sign in first.", 401);
  const grant = await supabase.rpc("authorize_privacy_response_preview", { p_response_id: responseId });
  if (grant.error) return refuse(privacyResponseError(grant.error.message), 403);
  const value = grant.data as { bucket?: unknown; storage_key?: unknown; seconds?: unknown } | null;
  if (typeof value?.bucket !== "string" || typeof value.storage_key !== "string" || typeof value.seconds !== "number") return refuse("That package can’t be opened.", 404);
  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return refuse("Downloads are not available right now.", 503);
  }
  const signed = await service.storage.from(value.bucket).createSignedUrl(value.storage_key, value.seconds, { download: true });
  if (signed.error || !signed.data?.signedUrl) return refuse("That package can’t be opened.", 502);
  return NextResponse.json({ url: signed.data.signedUrl, seconds: value.seconds });
}
