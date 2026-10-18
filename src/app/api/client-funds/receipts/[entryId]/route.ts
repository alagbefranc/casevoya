import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { receiptFilename, receiptFromRpc, renderReceiptPdf } from "@/modules/finance/receipt-pdf";

/**
 * The receipt for a verified advance (CICC Code s. 32(b)), as a PDF. Read as the signed-in person:
 * `client_fund_receipt` lets in the matter's billing staff and the client whose money it is, in the
 * active workspace, and audits each read. Nothing is stored; the PDF is drawn from the immutable
 * receipt row each time.
 */
export async function GET(request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  const { entryId } = await params;
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!isUuid(entryId) || !organizationId || !isUuid(organizationId)) {
    return NextResponse.json({ error: "Choose the receipt." }, { status: 400 });
  }

  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("client_fund_receipt", { p_entry_id: entryId });
  if (error) return NextResponse.json({ error: "That receipt is not available." }, { status: 403 });
  const receipt = receiptFromRpc(data);
  if (!receipt) return NextResponse.json({ error: "That receipt is not available." }, { status: 404 });

  const bytes = await renderReceiptPdf(receipt);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${receiptFilename(receipt)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
