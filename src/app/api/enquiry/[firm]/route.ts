import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ENQUIRY_CONSENT, ENQUIRY_MESSAGES, readEnquiry } from "@/modules/leads/enquiry";
import { clientHash } from "@/modules/scheduling/public-api";
import { clientAddress } from "@/modules/scheduling/public-deps";

/**
 * A prospect's enquiry from the firm's hosted page or embedded form (CRM-01). It becomes a lead
 * in New with the reply consent and, only when ticked, a separate marketing consent, each stored
 * with its exact wording, a hash and the wording's version. Abuse controls: a honeypot field,
 * and a per-address and per-firm limit in the database (the address is stored only as a hash).
 * A firm in sample mode, or without a published privacy notice, takes no enquiries.
 */
export async function POST(request: Request, { params }: { params: Promise<{ firm: string }> }) {
  const { firm } = await params;
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return NextResponse.json({ error: "invalid", message: ENQUIRY_MESSAGES.invalid }, { status: 415 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid", message: ENQUIRY_MESSAGES.invalid }, { status: 400 });
  }
  const read = readEnquiry(body);
  if ("error" in read) return NextResponse.json({ error: read.error, message: ENQUIRY_MESSAGES[read.error] }, { status: 400 });
  const input = read.input;
  try {
    const hash = await clientHash(clientAddress(request.headers), process.env.BOOKING_CLIENT_SALT ?? "");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("submit_enquiry", {
      p_firm_slug: firm.toLowerCase(),
      p_name: input.name,
      p_contact: input.contact,
      p_preferred_contact: input.preferred,
      p_service_interest: input.service,
      p_country_now: input.country,
      p_language: input.language,
      p_reply_consent: true,
      p_reply_statement: ENQUIRY_CONSENT.reply,
      p_marketing_consent: input.marketing,
      p_marketing_statement: input.marketing ? ENQUIRY_CONSENT.marketing : null,
      p_consent_version: ENQUIRY_CONSENT.version,
      p_source: input.source,
      p_idempotency_key: input.key,
      p_client_hash: hash,
    });
    if (error) throw new Error("submit_enquiry failed");
    const result = (data && typeof data === "object" ? data : {}) as { ok?: boolean; error?: keyof typeof ENQUIRY_MESSAGES };
    if (result.ok) return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    const code = result.error && result.error in ENQUIRY_MESSAGES ? result.error : "unavailable";
    const status = code === "form_unavailable" ? 404 : code === "enquiry_rate_limited" ? 429 : 400;
    return NextResponse.json({ error: code, message: ENQUIRY_MESSAGES[code] }, { status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "unavailable", message: ENQUIRY_MESSAGES.unavailable }, { status: 502 });
  }
}
