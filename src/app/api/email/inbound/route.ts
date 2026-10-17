import { NextResponse } from "next/server";
import { verifyPayload } from "@/modules/email/sign";
import type { InboundAttachment, InboundPayload } from "@/modules/email/inbound";
import { emailRuntimeConfig } from "@/lib/email/env";
import { runInboundEmail } from "@/modules/email/run-inbound";

function asPayload(value: unknown): InboundPayload | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.from !== "string" || typeof record.to !== "string" || typeof record.messageId !== "string") {
    return null;
  }
  const attachments: InboundAttachment[] = [];
  if (Array.isArray(record.attachments)) {
    for (const item of record.attachments) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (typeof row.contentBase64 !== "string") continue;
      attachments.push({
        filename: typeof row.filename === "string" ? row.filename : null,
        mimeType: typeof row.mimeType === "string" ? row.mimeType : null,
        contentBase64: row.contentBase64,
      });
    }
  }
  return {
    from: record.from,
    to: record.to,
    messageId: record.messageId,
    subject: typeof record.subject === "string" ? record.subject : null,
    text: typeof record.text === "string" ? record.text : null,
    html: typeof record.html === "string" ? record.html : null,
    // Only an explicit true from the signed worker payload counts.
    senderVerified: record.senderVerified === true,
    attachments,
  };
}

/** Cloudflare inbound worker posts here. The body is signed with EMAIL_INBOUND_WEBHOOK_SECRET. */
export async function POST(request: Request) {
  const config = emailRuntimeConfig();
  if (!config.inboundSecret || !config.serviceKey) {
    return NextResponse.json({ error: "Inbound email is not configured." }, { status: 503 });
  }
  const body = await request.text();
  const timestamp = request.headers.get("x-casevoya-timestamp") ?? "";
  const signature = request.headers.get("x-casevoya-signature") ?? "";
  const valid = await verifyPayload(config.inboundSecret, timestamp, body, signature);
  if (!valid) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Send a JSON message." }, { status: 400 });
  }
  const payload = asPayload(parsed);
  if (!payload || payload.messageId.trim().length < 1) {
    return NextResponse.json({ error: "Message id is required." }, { status: 400 });
  }
  try {
    const result = await runInboundEmail(payload);
    const status = result.status === "unknown_firm" || result.status === "reserved" || result.status === "bad_address" ? 422 : 200;
    return NextResponse.json(result, { status });
  } catch {
    return NextResponse.json({ error: "Inbound email failed." }, { status: 500 });
  }
}
