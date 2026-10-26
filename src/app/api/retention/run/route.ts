import { NextResponse } from "next/server";
import { emailRuntimeConfig } from "@/lib/email/env";
import { createServiceClient } from "@/lib/supabase/service";
import { timingSafeEqual } from "@/modules/email/sign";
import { runDeletionJobs } from "@/modules/retention/runner";

/**
 * SEC-07: runs approved deletion jobs (files and derived data of closed matters past their
 * retention end, approved by the firm owner). The caller is the scheduler
 * (app.kick_retention_runner, every 5 minutes while a job waits) with the mail dispatch bearer
 * (EMAIL_DISPATCH_SECRET), like WhatsApp dispatch. Storage objects are removed only here.
 */
export async function POST(request: Request) {
  const config = emailRuntimeConfig();
  if (!config.dispatchSecret || !config.serviceKey) {
    return NextResponse.json({ error: "The retention runner is not configured." }, { status: 503 });
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!timingSafeEqual(token, config.dispatchSecret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const service = createServiceClient();
    const summary = await runDeletionJobs({
      claim: async () => service.rpc("service_claim_deletion_job"),
      ready: async (itemId) => service.rpc("service_deletion_item_ready", { p_item_id: itemId }),
      record: async (itemId, outcome) => service.rpc("service_record_deletion_item", { p_item_id: itemId, p_outcome: outcome }),
      finish: async (jobId) => service.rpc("service_finish_deletion_job", { p_job_id: jobId }),
      remove: async (bucket, key) => {
        const removed = await service.storage.from(bucket).remove([key]);
        if (removed.error) return "error";
        return (removed.data ?? []).length > 0 ? "deleted" : "missing";
      },
    });
    return NextResponse.json(summary);
  } catch {
    return NextResponse.json({ error: "The retention runner failed." }, { status: 500 });
  }
}
