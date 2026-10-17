import { NextResponse } from "next/server";
import { timingSafeEqual } from "@/modules/email/sign";
import { emailRuntimeConfig } from "@/lib/email/env";
import { runEmailDispatch } from "@/modules/email/run-dispatch";

/** Drains mail outbox events. The caller is a scheduler with EMAIL_DISPATCH_SECRET. */
export async function POST(request: Request) {
  const config = emailRuntimeConfig();
  if (!config.dispatchSecret || !config.serviceKey || !config.token) {
    return NextResponse.json({ error: "Email dispatch is not configured." }, { status: 503 });
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!timingSafeEqual(token, config.dispatchSecret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const result = await runEmailDispatch();
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Email dispatch failed." }, { status: 500 });
  }
}
