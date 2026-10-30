import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ENQUIRY_CONSENT, ENQUIRY_MESSAGES, enquiryStatements, isFirmSlug, parsePublicFirm, readEnquiry } from "@/modules/leads/enquiry";
import { clientHash } from "@/modules/scheduling/public-api";
import { clientAddress, sessionViewerWithAssurance } from "@/modules/scheduling/public-deps";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * A prospect's enquiry from the firm's hosted page or embedded form (CRM-01). It becomes a lead
 * in New with the reply consent and, only when ticked, a separate marketing consent, each stored
 * with the exact wording the visitor saw (it names the firm), a hash and the wording's version.
 * Abuse controls: a honeypot field, a form timer, and a per-address and per-firm limit in the
 * database (the address is stored only as a hash). A firm without a published privacy notice
 * takes no enquiries; a firm in sample mode takes practice enquiries from its own staff only, and
 * those leads are sample rows.
 */
export async function POST(request: Request, { params }: { params: Promise<{ firm: string }> }) {
  const firm = (await params).firm.toLowerCase();
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return NextResponse.json({ error: "invalid", message: ENQUIRY_MESSAGES.invalid }, { status: 415, headers: NO_STORE });
  }
  if (!isFirmSlug(firm)) {
    return NextResponse.json({ error: "form_unavailable", message: ENQUIRY_MESSAGES.form_unavailable }, { status: 404, headers: NO_STORE });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid", message: ENQUIRY_MESSAGES.invalid }, { status: 400, headers: NO_STORE });
  }
  const read = readEnquiry(body);
  if ("error" in read) {
    return NextResponse.json({ error: read.error, message: ENQUIRY_MESSAGES[read.error] }, { status: read.error === "too_fast" ? 429 : 400, headers: NO_STORE });
  }
  const input = read.input;
  try {
    const supabase = await createClient();
    // The wording stored is the wording the page showed, which names the firm.
    const found = await supabase.rpc("enquiry_public_firm", { p_firm_slug: firm });
    if (found.error) throw new Error("enquiry_public_firm failed");
    const page = parsePublicFirm(found.data);
    if (!page) {
      return NextResponse.json({ error: "form_unavailable", message: ENQUIRY_MESSAGES.form_unavailable }, { status: 404, headers: NO_STORE });
    }
    if (!page.open) {
      return NextResponse.json({ error: "form_closed", message: ENQUIRY_MESSAGES.form_closed }, { status: 403, headers: NO_STORE });
    }
    const statements = enquiryStatements(page.firmName);
    const hash = await clientHash(clientAddress(request.headers), process.env.BOOKING_CLIENT_SALT ?? "");
    // submit_enquiry is service role only (the hash comes from this server). The page check
    // above ran on the visitor's session; the visitor and their session assurance are named so the
    // database re-checks staff with staff MFA for a practice enquiry and records who sent it.
    const viewer = await sessionViewerWithAssurance(supabase);
    const { data, error } = await createServiceClient().rpc("submit_enquiry", {
      p_firm_slug: firm,
      p_name: input.name,
      p_contact: input.contact,
      p_preferred_contact: input.preferred,
      p_service_interest: input.service,
      p_country_now: input.country,
      p_language: input.language,
      p_reply_consent: true,
      p_reply_statement: statements.reply,
      p_marketing_consent: input.marketing,
      p_marketing_statement: input.marketing ? statements.marketing : null,
      p_consent_version: ENQUIRY_CONSENT.version,
      p_source: input.source,
      p_idempotency_key: input.key,
      p_client_hash: hash,
      p_attribution: input.attribution,
      p_viewer: viewer?.id ?? null,
      p_viewer_aal: viewer?.aal ?? null,
    });
    if (error) throw new Error("submit_enquiry failed");
    const result = (data && typeof data === "object" ? data : {}) as { ok?: boolean; error?: keyof typeof ENQUIRY_MESSAGES };
    if (result.ok) return NextResponse.json({ ok: true, practice: page.practice }, { headers: NO_STORE });
    const code = result.error && result.error in ENQUIRY_MESSAGES ? result.error : "unavailable";
    const status = code === "form_unavailable" ? 404 : code === "form_closed" ? 403 : code === "enquiry_rate_limited" ? 429 : 400;
    return NextResponse.json({ error: code, message: ENQUIRY_MESSAGES[code] }, { status, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "unavailable", message: ENQUIRY_MESSAGES.unavailable }, { status: 502, headers: NO_STORE });
  }
}
