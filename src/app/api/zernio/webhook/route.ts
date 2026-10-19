import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { whatsappRuntimeConfig } from "@/modules/whatsapp/env";
import { signatureHeader, verifyZernioSignature } from "@/modules/whatsapp/signature";
import { parseZernioEvent } from "@/modules/whatsapp/webhook";

/**
 * Zernio webhook (message.received, message.delivered, message.read, message.failed). The raw
 * body's HMAC-SHA256 under ZERNIO_WEBHOOK_SECRET must match X-Zernio-Signature, or nothing is read.
 * Each event is applied once (deduped on Zernio's event id and Meta's message id) and the answer
 * is quick: Zernio retries anything that is not a 2xx within 5 seconds, which a database error
 * here asks for on purpose.
 */
export async function POST(request: Request) {
  const config = whatsappRuntimeConfig();
  if (!config.webhookSecret || !config.serviceKey) {
    return NextResponse.json({ error: "WhatsApp webhook is not configured." }, { status: 503 });
  }
  const raw = await request.text();
  if (raw.length > 512_000) return NextResponse.json({ error: "Too large." }, { status: 413 });
  if (!(await verifyZernioSignature(config.webhookSecret, raw, signatureHeader(request.headers)))) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const event = parseZernioEvent(payload);
  if (event.kind === "test" || event.kind === "ignore") return NextResponse.json({ ok: true });

  const supabase = createServiceClient();
  if (event.kind === "received") {
    const { error } = await supabase.rpc("receive_whatsapp_message", {
      p_account_id: event.accountId,
      p_event_id: event.eventId,
      p_platform_message_id: event.platformMessageId,
      p_conversation_id: event.conversationId ?? "",
      p_phone: event.phone ?? "",
      p_bsuid: event.bsuid ?? "",
      p_sender_name: event.senderName ?? "",
      p_text: event.text ?? "",
      p_has_attachments: event.hasAttachments,
      p_sent_at: event.sentAt ?? new Date().toISOString(),
    });
    if (error) return NextResponse.json({ error: "Not recorded." }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  const { error } = await supabase.rpc("record_whatsapp_status", {
    p_account_id: event.accountId,
    p_provider_message_id: event.providerMessageId,
    p_status: event.status,
    p_at: event.at ?? new Date().toISOString(),
    p_error: event.error ?? "",
  });
  if (error) return NextResponse.json({ error: "Not recorded." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
