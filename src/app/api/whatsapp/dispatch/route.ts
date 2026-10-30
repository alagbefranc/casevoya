import { NextResponse } from "next/server";
import { bearerToken, cronBearerAuthorized } from "@/modules/email/cron-auth";
import { whatsappRuntimeConfig } from "@/modules/whatsapp/env";
import { runWhatsAppDispatch } from "@/modules/whatsapp/run-dispatch";

/**
 * Drains WhatsApp outbox events. The caller is the same scheduler as mail dispatch
 * (app.kick_whatsapp_dispatch, cron bearer as in cron-auth.ts). Without ZERNIO_API_KEY nothing runs.
 */
export async function POST(request: Request) {
  const config = whatsappRuntimeConfig();
  if (!config.apiKey || !config.dispatchSecret || !config.serviceKey) {
    return NextResponse.json({ error: "WhatsApp dispatch is not configured." }, { status: 503 });
  }
  if (!(await cronBearerAuthorized(bearerToken(request), config))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    return NextResponse.json(await runWhatsAppDispatch());
  } catch {
    return NextResponse.json({ error: "WhatsApp dispatch failed." }, { status: 500 });
  }
}
