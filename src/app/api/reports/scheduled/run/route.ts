import { NextResponse } from "next/server";
import { emailRuntimeConfig } from "@/lib/email/env";
import { createServiceClient } from "@/lib/supabase/service";
import { timingSafeEqual } from "@/modules/email/sign";
import { runScheduledReports } from "@/modules/sheet/scheduled-reports-runner";

/**
 * REP-03: sends the scheduled reports that are due. The caller is the scheduler
 * (app.kick_scheduled_reports, every 5 minutes while one is due) with the mail dispatch bearer
 * (EMAIL_DISPATCH_SECRET), like the retention runner. Recipients get an in-app link only.
 */
export async function POST(request: Request) {
  const config = emailRuntimeConfig();
  if (!config.dispatchSecret || !config.serviceKey) {
    return NextResponse.json({ error: "The scheduled reports runner is not configured." }, { status: 503 });
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!timingSafeEqual(token, config.dispatchSecret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const service = createServiceClient();
    const summary = await runScheduledReports(async (limit) => service.rpc("service_run_scheduled_reports", { p_limit: limit }));
    return NextResponse.json(summary);
  } catch {
    return NextResponse.json({ error: "The scheduled reports runner failed." }, { status: 500 });
  }
}
