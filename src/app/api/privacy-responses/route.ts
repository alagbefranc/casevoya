import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/tenant/context";
import { privacyResponseError } from "@/modules/compliance/privacy-response-format";
import { buildPrivacyResponse } from "@/modules/exports/privacy-build";
import { loadSheetAccess } from "@/modules/sheet/load";

function refuse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/**
 * SEC-06: builds a privacy access response package in this request. public.start_privacy_response
 * checks the staff member works the request, the redaction step is recorded and a fresh step-up
 * (SEC-01 step-up for exports), and audits the start; the package is built with the client-file
 * export code and its size limits (Workers has no long-running jobs here).
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return refuse("This request must come from Casevoya.", 403);
  const body = (await request.json().catch(() => null)) as { organizationId?: unknown; requestId?: unknown; key?: unknown } | null;
  const organizationId = typeof body?.organizationId === "string" ? body.organizationId : "";
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  const key = typeof body?.key === "string" ? body.key : "";
  if (!isUuid(organizationId)) return refuse("Choose a firm.", 400);
  if (!isUuid(requestId)) return refuse("Refresh the page and try again.", 400);
  if (key.length < 8 || key.length > 180) return refuse("Try again.", 400);

  const access = await loadSheetAccess();
  if ((access.kind !== "live" && access.kind !== "sample") || access.staff.organizationId !== organizationId) return refuse("Sign in first.", 401);
  const supabase = await createClient({ organizationId });
  const started = await supabase.rpc("start_privacy_response", { p_request_id: requestId, p_idempotency_key: key });
  if (started.error || !started.data) return refuse(privacyResponseError(started.error?.message ?? ""), 403);

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return refuse("Packages can’t be built right now.", 503);
  }
  const built = await buildPrivacyResponse({
    supabase,
    service,
    organizationId,
    responseId: started.data,
    requestId,
    firm: access.staff.organizationName,
    requester: access.staff.displayName,
    timezone: access.staff.timezone,
  });
  if (!built.ok) return refuse(built.error, 500);
  return NextResponse.json({ id: started.data });
}
