import { NextResponse } from "next/server";
import { emailRuntimeConfig } from "@/lib/email/env";
import { createServiceClient } from "@/lib/supabase/service";
import { timingSafeEqual } from "@/modules/email/sign";
import { runDocumentScans } from "@/modules/documents/scan-runner";
import { serviceScanDeps } from "@/modules/documents/scan-service";

/**
 * #263-B: scans the uploads that are due (held as "scanning", or retrying after scan_failed).
 * The caller is the scheduler (app.kick_document_scans, every minute while one is due) with the
 * mail dispatch bearer (EMAIL_DISPATCH_SECRET), like the scheduled reports runner, or
 * scripts/rescan-legacy-documents.mjs with {"backfill": true} for files stored before scanning.
 * Each run takes a few files; the rest wait for the next minute. Each scan request lets the
 * scanner wake and load first (RUNNER_SCAN_BUDGET, up to 140 s), so the kick waits 240 s
 * (20261029200000): a Worker whose caller disconnects may be cancelled.
 */
export async function POST(request: Request) {
  const config = emailRuntimeConfig();
  if (!config.dispatchSecret || !config.serviceKey) {
    return NextResponse.json({ error: "The document scan runner is not configured." }, { status: 503 });
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!timingSafeEqual(token, config.dispatchSecret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  let body: { limit?: unknown; backfill?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const limit = typeof body.limit === "number" ? body.limit : 5;
  try {
    const service = createServiceClient();
    const summary = await runDocumentScans(serviceScanDeps(service), { limit, backfill: body.backfill === true });
    return NextResponse.json({ claimed: summary.claimed, clean: summary.clean, infected: summary.infected, errors: summary.errors });
  } catch {
    return NextResponse.json({ error: "The document scan runner failed." }, { status: 500 });
  }
}
