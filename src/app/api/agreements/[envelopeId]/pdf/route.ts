import { NextResponse } from "next/server";
import { pdfBytes } from "@/modules/agreements/pdf";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";

/** Streams the immutable sealed PDF or completion certificate. RLS decides who may read it. */
export async function GET(request: Request, { params }: { params: Promise<{ envelopeId: string }> }) {
  const { envelopeId } = await params;
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId");
  const certificate = url.searchParams.get("which") === "certificate";
  if (!isUuid(envelopeId) || !organizationId || !isUuid(organizationId)) {
    return NextResponse.json({ error: "Choose the signed agreement." }, { status: 400 });
  }

  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const { data, error } = await supabase.rpc(
    certificate ? "agreement_certificate_pdf" : "agreement_executed_pdf",
    { p_envelope_id: envelopeId },
  );
  if (error) return NextResponse.json({ error: "That copy is not available." }, { status: 403 });
  const bytes = pdfBytes(data);
  if (!bytes) return NextResponse.json({ error: "The executed copy is not ready." }, { status: 404 });

  const filename = certificate ? "completion-certificate.pdf" : "executed-agreement.pdf";
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
