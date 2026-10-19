import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { invoiceFilename, renderInvoicePdf } from "@/modules/finance/invoice-pdf";
import { billedTo } from "@/modules/sheet/finance-present";

/**
 * An issued invoice, as a PDF. Read as the signed-in person, so RLS decides: the matter's billing
 * staff, or a client who is a party on the matter (never a draft). Nothing is stored; the PDF is
 * drawn from the invoice as it stands, each time.
 */
export async function GET(request: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!isUuid(invoiceId) || !organizationId || !isUuid(organizationId)) {
    return NextResponse.json({ error: "Choose the invoice." }, { status: 400 });
  }

  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, matter_id, number, description, fee_category, amount_cents, currency, paid_cents, refunded_cents, credited_cents, status, issued_on, due_on, is_sample, created_at")
    .eq("organization_id", organizationId)
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice || invoice.status === "draft") return NextResponse.json({ error: "That invoice is not available." }, { status: 404 });

  const [matter, firm] = await Promise.all([
    supabase
      .from("matters")
      .select("reference, title, responsible_consultant_membership_id, matter_participants(role, persons(display_name))")
      .eq("organization_id", organizationId)
      .eq("id", invoice.matter_id)
      .maybeSingle(),
    supabase.from("organizations").select("legal_name, display_name").eq("id", organizationId).maybeSingle(),
  ]);
  const consultant = matter.data?.responsible_consultant_membership_id ?? null;
  const credential = consultant
    ? await supabase
        .from("consultant_credentials")
        .select("licence_type, college_id")
        .eq("organization_id", organizationId)
        .eq("membership_id", consultant)
        .order("declared_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : null;
  const firmName = firm.data?.display_name ?? firm.data?.legal_name ?? "Firm";

  const bytes = await renderInvoicePdf({
    number: invoice.number,
    description: invoice.description,
    feeCategory: invoice.fee_category,
    status: invoice.status,
    amountCents: invoice.amount_cents,
    paidCents: invoice.paid_cents,
    creditedCents: invoice.credited_cents,
    refundedCents: invoice.refunded_cents,
    currency: invoice.currency,
    issuedOn: invoice.issued_on,
    dueOn: invoice.due_on,
    createdAt: invoice.created_at,
    clientName: billedTo(matter.data?.matter_participants ?? []),
    matterLabel: [matter.data?.reference, matter.data?.title].filter(Boolean).join(" · ") || "Matter",
    firmLegalName: firm.data?.legal_name ?? firmName,
    firmDisplayName: firmName,
    // The licensee's name isn't readable to every billing role; the licence is shown when it is on file.
    consultantName: null,
    consultantLicence: credential?.data ? `${credential.data.licence_type} ${credential.data.college_id}` : null,
    isSample: invoice.is_sample,
  });
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoiceFilename(invoice)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
