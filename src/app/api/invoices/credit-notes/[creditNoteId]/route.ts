import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { creditNoteFilename, creditNoteFromRpc, renderCreditNotePdf } from "@/modules/finance/credit-note-pdf";

/**
 * An issued credit note, as a PDF. Read as the signed-in person: `invoice_credit_note` lets in the
 * matter's billing staff and a client who is a party on the invoice's matter, in the active
 * workspace, and audits each read. Drafts and declined notes are never served. Nothing is stored;
 * the PDF is drawn from the immutable credit note row each time.
 */
export async function GET(request: Request, { params }: { params: Promise<{ creditNoteId: string }> }) {
  const { creditNoteId } = await params;
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!isUuid(creditNoteId) || !organizationId || !isUuid(organizationId)) {
    return NextResponse.json({ error: "Choose the credit note." }, { status: 400 });
  }

  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("invoice_credit_note", { p_credit_note_id: creditNoteId });
  if (error) return NextResponse.json({ error: "That credit note is not available." }, { status: 403 });
  const note = creditNoteFromRpc(data);
  if (!note) return NextResponse.json({ error: "That credit note is not available." }, { status: 404 });

  const bytes = await renderCreditNotePdf(note);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${creditNoteFilename(note)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
