import { NextResponse } from "next/server";
import { verifyTotpCode } from "@/lib/auth/verify-totp";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/tenant/context";
import { buildMatterExport } from "@/modules/exports/build";
import { exportError } from "@/modules/sheet/exports-present";
import { loadSheetAccess } from "@/modules/sheet/load";

function refuse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/**
 * Starts a client-file export (T040) and builds it in this request. The requester confirms with
 * their authenticator first (SEC-01 step-up for exports); public.start_matter_export checks access
 * and the step-up and audits the start. The package is built on request with size limits because
 * Workers has no long-running jobs here; progress is stored so the page shows each step.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return refuse("This request must come from Casevoya.", 403);
  const body = (await request.json().catch(() => null)) as { organizationId?: unknown; matterId?: unknown; code?: unknown; key?: unknown; verifyOnly?: unknown } | null;
  const organizationId = typeof body?.organizationId === "string" ? body.organizationId : "";
  const matterId = typeof body?.matterId === "string" ? body.matterId : "";
  const code = typeof body?.code === "string" ? body.code : "";
  const key = typeof body?.key === "string" ? body.key : "";
  if (!isUuid(organizationId)) return refuse("Choose a firm.", 400);
  const verifyOnly = body?.verifyOnly === true;
  if (!isUuid(matterId)) return refuse("Choose the matter to export.", 400);
  if (verifyOnly && !code) return refuse("Enter the 6-digit code from your authenticator app.", 400);
  if (!verifyOnly && (key.length < 8 || key.length > 180)) return refuse("Try again.", 400);

  const access = await loadSheetAccess();
  if ((access.kind !== "live" && access.kind !== "sample") || access.staff.organizationId !== organizationId) return refuse("Sign in first.", 401);
  const supabase = await createClient({ organizationId });
  if (code) {
    const verified = await verifyTotpCode(supabase, code);
    if (!verified.ok) return refuse(verified.error, 403);
  }
  // The page checks the code first, so a wrong code never shows "Export started"; the build then
  // runs in a second request on the refreshed (stepped-up) session.
  if (verifyOnly) return NextResponse.json({ verified: true });
  const started = await supabase.rpc("start_matter_export", { p_matter_id: matterId, p_idempotency_key: key });
  if (started.error || !started.data) return refuse(exportError(started.error?.message ?? ""), 403);

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return refuse("Exports are not available right now.", 503);
  }
  const built = await buildMatterExport({
    supabase,
    service,
    organizationId,
    exportId: started.data,
    matterId,
    firm: access.staff.organizationName,
    requester: access.staff.displayName,
    timezone: access.staff.timezone,
  });
  if (!built.ok) return refuse(built.error, 500);
  return NextResponse.json({ id: started.data, excluded: built.excluded });
}
