import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/tenant/context";
import { LICENCE_PROOF_BUCKET, ownLicenceProofKey } from "@/modules/firm-onboarding/licence-proof";

/** How long the signed link to a licence proof works. */
const PROOF_LINK_SECONDS = 60;

function refuse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/**
 * Opens a consultant's licence proof through a short signed link. The credential is read as the
 * signed-in person (RLS: staff of the firm at two-step), and only the firm owner or the licence
 * holder may open its proof. The file stays in the private licence-proofs bucket; the link is
 * made with the service role only for a locator that is that membership's own stored file.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId") ?? "";
  const credentialId = url.searchParams.get("credential") ?? "";
  if (!isUuid(organizationId) || !isUuid(credentialId)) return refuse("Choose the licence.", 400);

  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  const userId = typeof claims?.claims?.sub === "string" ? claims.claims.sub : null;
  if (!userId) return refuse("Sign in first.", 401);

  const { data: credential } = await supabase
    .from("consultant_credentials")
    .select("id, membership_id, proof_locator")
    .eq("organization_id", organizationId)
    .eq("id", credentialId)
    .maybeSingle();
  if (!credential?.proof_locator) return refuse("There’s no proof on file for this licence.", 404);

  const { data: memberships } = await supabase
    .from("memberships")
    .select("id, role, user_id, status")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active");
  const mine = memberships ?? [];
  const allowed = mine.some((row) => row.role === "firm_owner" || row.id === credential.membership_id);
  if (!allowed) return refuse("Only the firm owner or the licence holder can open this proof.", 403);

  const key = ownLicenceProofKey(credential.proof_locator, organizationId, credential.membership_id);
  if (!key) return refuse("That proof file isn’t available.", 404);
  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return refuse("Proofs can’t be opened right now.", 503);
  }
  const { data: signed } = await service.storage.from(LICENCE_PROOF_BUCKET).createSignedUrl(key, PROOF_LINK_SECONDS);
  if (!signed?.signedUrl) return refuse("That proof file isn’t available.", 404);
  return NextResponse.redirect(signed.signedUrl, { status: 303, headers: { "Cache-Control": "private, no-store" } });
}
