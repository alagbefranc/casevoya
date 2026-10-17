import { NextResponse } from "next/server";
import { pdfBytes } from "@/modules/agreements/pdf";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";

/** Streams the in-app invoice PDF. RLS decides who may read it. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!isUuid(id) || !organizationId || !isUuid(organizationId)) {
    return NextResponse.json({ error: "Choose the invoice." }, { status: 400 });
  }
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data, error } = await supabase.rpc("billing_document_pdf", { p_id: id });
  if (error) return NextResponse.json({ error: "That invoice is not available." }, { status: 403 });
  const bytes = pdfBytes(data);
  if (!bytes) return NextResponse.json({ error: "The invoice PDF is not ready." }, { status: 404 });
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="invoice.pdf"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
