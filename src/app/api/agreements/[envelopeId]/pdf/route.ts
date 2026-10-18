import { NextResponse } from "next/server";
import { pdfBytes } from "@/modules/agreements/pdf";
import { sealEnvelope } from "@/modules/agreements/seal";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";

/**
 * Streams the immutable sealed PDF or completion certificate. RLS decides who may read it.
 * Whatever bytes are stored are served unchanged (including copies sealed before the laid-out
 * renderer). A completed envelope that has no sealed copy yet is sealed once here, then read
 * back through the same RLS-checked function.
 */
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

  const read = () =>
    supabase.rpc(certificate ? "agreement_certificate_pdf" : "agreement_executed_pdf", { p_envelope_id: envelopeId });
  let { data, error } = await read();
  if (error) return NextResponse.json({ error: "That copy is not available." }, { status: 403 });
  if (!data) {
    // The caller may read this envelope (the call above passed RLS). Seal it if it is complete.
    const sealed = await sealEnvelope(envelopeId);
    if (sealed.ok) ({ data, error } = await read());
    if (error) return NextResponse.json({ error: "That copy is not available." }, { status: 403 });
  }
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
