import { NextResponse } from "next/server";
import { bearerToken, cronBearerAuthorized } from "@/modules/email/cron-auth";
import { emailRuntimeConfig } from "@/lib/email/env";
import { runEmailDispatch } from "@/modules/email/run-dispatch";

/** Drains mail outbox events. The caller is a scheduler with the cron bearer (cron-auth.ts). */
export async function POST(request: Request) {
  const config = emailRuntimeConfig();
  if (!config.dispatchSecret || !config.serviceKey || !config.token) {
    return NextResponse.json({ error: "Email dispatch is not configured." }, { status: 503 });
  }
  if (!(await cronBearerAuthorized(bearerToken(request), config))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const result = await runEmailDispatch();
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Email dispatch failed." }, { status: 500 });
  }
}
