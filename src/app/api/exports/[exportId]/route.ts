import { NextResponse } from "next/server";
import { verifyTotpCode } from "@/lib/auth/verify-totp";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/tenant/context";
import { EXPORT_FILE_MISSING, exportError, exportRefusalStatus, storageObjectMissing } from "@/modules/sheet/exports-present";

function refuse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/**
 * One export job: `{ action: "download", code }` returns a 60-second signed link to the private
 * ZIP after public.authorize_matter_export_download (requester or firm owner, fresh step-up,
 * within 24 hours, audited); `{ action: "cancel" }` cancels a build.
 */
export async function POST(request: Request, { params }: { params: Promise<{ exportId: string }> }) {
  const { exportId } = await params;
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return refuse("This request must come from Casevoya.", 403);
  const body = (await request.json().catch(() => null)) as { organizationId?: unknown; action?: unknown; code?: unknown } | null;
  const organizationId = typeof body?.organizationId === "string" ? body.organizationId : "";
  if (!isUuid(exportId) || !isUuid(organizationId)) return refuse("Choose the export.", 400);

  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return refuse("Sign in first.", 401);

  if (body?.action === "cancel") {
    const cancelled = await supabase.rpc("cancel_matter_export", { p_export_id: exportId });
    if (cancelled.error) return refuse(exportError(cancelled.error.message), 403);
    return NextResponse.json({ ok: true });
  }
  if (body?.action !== "download") return refuse("Choose what to do.", 400);

  const code = typeof body.code === "string" ? body.code : "";
  if (code) {
    const verified = await verifyTotpCode(supabase, code);
    if (!verified.ok) return refuse(verified.error, 403);
  }
  const grant = await supabase.rpc("authorize_matter_export_download", { p_export_id: exportId });
  // A deleted or expired export is gone (410), with words the page shows as they are.
  if (grant.error) return refuse(exportError(grant.error.message), exportRefusalStatus(grant.error.message));
  const value = grant.data as { bucket?: unknown; storage_key?: unknown; seconds?: unknown } | null;
  if (typeof value?.bucket !== "string" || typeof value.storage_key !== "string" || typeof value.seconds !== "number") {
    return refuse("That export can't be downloaded.", 404);
  }
  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return refuse("Downloads are not available right now.", 503);
  }
  const signed = await service.storage.from(value.bucket).createSignedUrl(value.storage_key, value.seconds, { download: true });
  // #262: the ZIP missing from storage is a clear 404, and any other storage failure says to retry, never a bare 502.
  if (signed.error && storageObjectMissing(signed.error)) return refuse(EXPORT_FILE_MISSING, 404);
  if (signed.error || !signed.data?.signedUrl) return refuse("Downloads aren’t working right now. Try again in a few minutes.", 503);
  return NextResponse.json({ url: signed.data.signedUrl, seconds: value.seconds });
}
