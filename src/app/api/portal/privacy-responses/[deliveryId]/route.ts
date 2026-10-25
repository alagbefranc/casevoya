import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/tenant/context";
import { privacyResponseError } from "@/modules/compliance/privacy-response-format";

function refuse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/**
 * SEC-06: the person downloads the privacy response their firm delivered. The database checks it is
 * theirs (their own portal login, still active in the firm) and within 30 days, records the
 * download with the package hash (the delivery proof) and audits it; then a 60-second signed link.
 */
export async function POST(request: Request, { params }: { params: Promise<{ deliveryId: string }> }) {
  const { deliveryId } = await params;
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return refuse("This request must come from Casevoya.", 403);
  const body = (await request.json().catch(() => null)) as { organizationId?: unknown } | null;
  const organizationId = typeof body?.organizationId === "string" ? body.organizationId : "";
  if (!isUuid(deliveryId) || !isUuid(organizationId)) return refuse("Choose the download.", 400);
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return refuse("Sign in first.", 401);
  const grant = await supabase.rpc("authorize_privacy_response_download", { p_delivery_id: deliveryId });
  if (grant.error) return refuse(privacyResponseError(grant.error.message), 403);
  const value = grant.data as { bucket?: unknown; storage_key?: unknown; seconds?: unknown } | null;
  if (typeof value?.bucket !== "string" || typeof value.storage_key !== "string" || typeof value.seconds !== "number") return refuse("That download isn’t available.", 404);
  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return refuse("Downloads are not available right now.", 503);
  }
  const signed = await service.storage.from(value.bucket).createSignedUrl(value.storage_key, value.seconds, { download: true });
  if (signed.error || !signed.data?.signedUrl) return refuse("That download isn’t available.", 502);
  return NextResponse.json({ url: signed.data.signedUrl });
}
