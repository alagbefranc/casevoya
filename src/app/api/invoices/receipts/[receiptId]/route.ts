import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { paymentReceiptFilename, paymentReceiptFromRpc, renderPaymentReceiptPdf } from "@/modules/finance/payment-receipt";

/**
 * The receipt for a payment of an invoice (CICC Code s. 33(3)), as a PDF. Read as the signed-in
 * person: `invoice_payment_receipt` lets in the matter's billing staff and the client who paid, in
 * the active workspace, and audits each read. Nothing is stored; the PDF is drawn from the immutable
 * receipt row each time.
 */
export async function GET(request: Request, { params }: { params: Promise<{ receiptId: string }> }) {
  const { receiptId } = await params;
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!isUuid(receiptId) || !organizationId || !isUuid(organizationId)) {
    return NextResponse.json({ error: "Choose the receipt." }, { status: 400 });
  }

  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("invoice_payment_receipt", { p_receipt_id: receiptId });
  if (error) return NextResponse.json({ error: "That receipt is not available." }, { status: 403 });
  const receipt = paymentReceiptFromRpc(data);
  if (!receipt) return NextResponse.json({ error: "That receipt is not available." }, { status: 404 });

  const bytes = await renderPaymentReceiptPdf(receipt);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${paymentReceiptFilename(receipt)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
