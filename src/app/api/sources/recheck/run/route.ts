import { NextResponse } from "next/server";
import type { Json } from "@/types/database.types";
import { emailRuntimeConfig } from "@/lib/email/env";
import { createServiceClient } from "@/lib/supabase/service";
import { bearerToken, cronBearerAuthorized } from "@/modules/email/cron-auth";
import { runSourceRechecks } from "@/modules/content-governance/source-recheck-run";

/**
 * SRC-04: re-checks official pages that are due. The caller is the scheduler
 * (app.kick_source_rechecks, hourly while a page is due) with the cron bearer
 * (cron-auth.ts), like the document scan runner. A changed page is hashed and,
 * when its section can be read, published by the database. A failed fetch is recorded
 * and does not move "last checked".
 */
export async function POST(request: Request) {
  const config = emailRuntimeConfig();
  if (!config.dispatchSecret || !config.serviceKey) {
    return NextResponse.json({ error: "The source re-check runner is not configured." }, { status: 503 });
  }
  if (!(await cronBearerAuthorized(bearerToken(request), config))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  let body: { limit?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const limit = typeof body.limit === "number" ? body.limit : 5;
  try {
    const service = createServiceClient();
    const summary = await runSourceRechecks({
      due: async (count) => {
        const { data, error } = await service.rpc("service_sources_due", { p_limit: count });
        if (error) throw new Error(error.message);
        return data;
      },
      record: async (payload) => {
        const { data, error } = await service.rpc("service_record_official_recheck", { p_payload: payload as Json });
        if (error) throw new Error(error.message);
        return data;
      },
    }, limit);
    return NextResponse.json(summary);
  } catch {
    return NextResponse.json({ error: "The source re-check runner failed." }, { status: 500 });
  }
}
