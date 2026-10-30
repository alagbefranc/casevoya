import { NextResponse } from "next/server";
import { emailRuntimeConfig } from "@/lib/email/env";
import { createServiceClient } from "@/lib/supabase/service";
import { bearerToken, cronBearerAuthorized } from "@/modules/email/cron-auth";
import { runScheduledReports } from "@/modules/sheet/scheduled-reports-runner";

/**
 * REP-03: sends the scheduled reports that are due. The caller is the scheduler
 * (app.kick_scheduled_reports, every 5 minutes while one is due) with the cron bearer
 * (cron-auth.ts), like the retention runner. Recipients get an in-app link only.
 */
export async function POST(request: Request) {
  const config = emailRuntimeConfig();
  if (!config.dispatchSecret || !config.serviceKey) {
    return NextResponse.json({ error: "The scheduled reports runner is not configured." }, { status: 503 });
  }
  if (!(await cronBearerAuthorized(bearerToken(request), config))) {
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
