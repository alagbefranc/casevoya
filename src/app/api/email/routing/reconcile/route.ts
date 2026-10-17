import { NextResponse } from "next/server";
import { timingSafeEqual } from "@/modules/email/sign";
import { emailRuntimeConfig } from "@/lib/email/env";
import { runRoutingReconcile } from "@/modules/email/sync-routing";

/** Repairs per-firm Email Routing rules. The caller holds EMAIL_ROUTING_RECONCILE_SECRET. */
export async function POST(request: Request) {
  const config = emailRuntimeConfig();
  if (!config.routingReconcileSecret || !config.routingToken || !config.serviceKey) {
    return NextResponse.json({ error: "Email routing reconcile is not configured." }, { status: 503 });
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!timingSafeEqual(token, config.routingReconcileSecret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const result = await runRoutingReconcile();
    const status = result.failures.length > 0 ? 502 : 200;
    return NextResponse.json(result, { status });
  } catch (error) {
    console.error("email routing reconcile failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Email routing reconcile failed." }, { status: 500 });
  }
}
