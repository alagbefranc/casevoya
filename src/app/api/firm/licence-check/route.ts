import { NextResponse } from "next/server";
import { safeAccessError } from "@/lib/auth/step-up";
import { verifyTotpCode } from "@/lib/auth/verify-totp";
import { licenceCheckInputSchema } from "@/modules/firm-onboarding";
import { createClient } from "@/lib/supabase/server";

/**
 * Stores a licence check a reviewer typed in after looking at the CICC public
 * register. This route does not request register.college-ic.ca.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON licence check." }, { status: 400 });
  }
  const parsed = licenceCheckInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "The licence check is incomplete." }, { status: 400 });
  }

  const supabase = await createClient({ organizationId: parsed.data.organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const verified = await verifyTotpCode(supabase, parsed.data.code);
  if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: 403 });

  const { data, error } = await supabase.rpc("record_licence_check", {
    p_credential_id: parsed.data.credentialId,
    p_source_url: parsed.data.sourceUrl,
    p_retrieved_at: parsed.data.retrievedAt,
    p_register_status: parsed.data.registerStatus,
    p_entitlement_to_practise: parsed.data.entitlementToPractise,
    p_discipline_suspended: parsed.data.disciplineSuspended,
    p_discipline_revoked: parsed.data.disciplineRevoked,
    p_discipline_restricted: parsed.data.disciplineRestricted,
    p_discipline_restriction_detail: parsed.data.disciplineRestrictionDetail ?? "",
    p_proof_locator: parsed.data.proofLocator,
    p_notes: parsed.data.notes ?? "",
  });
  if (error || typeof data !== "string") {
    return NextResponse.json({ error: safeAccessError(error?.message ?? "") }, { status: 403 });
  }
  return NextResponse.json({ id: data });
}
