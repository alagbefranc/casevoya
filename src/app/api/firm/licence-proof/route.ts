import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  LICENCE_PROOF_BUCKET,
  LICENCE_PROOF_MAX_BYTES,
  licenceProofKey,
  licenceProofLocator,
  licenceProofType,
  proofDisplayName,
} from "@/modules/firm-onboarding/licence-proof";

const LICENSED = ["firm_owner", "licensed_consultant"] as const;

/** The browser sends the file name URI-encoded; a malformed one is just not shown. */
function headerName(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function refuse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/**
 * Stores a licence proof (register screenshot or certificate) for the caller's own membership.
 * The body is the raw file. The server checks the bytes, then writes the file with the service
 * role to a private bucket that browsers cannot write to. The credential is declared later with
 * the returned locator, and setup checks the locator is this membership's own stored file.
 */
export async function POST(request: Request) {
  // Cookie-authenticated, so only this site's own pages may post here.
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return refuse("This upload must come from Casevoya.", 403);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > LICENCE_PROOF_MAX_BYTES) return refuse("Use a file under 10 MB.", 413);

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return refuse("Sign in first.", 401);
  const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level?.currentLevel !== "aal2") {
    const { data: satisfied } = await supabase.rpc("session_mfa_satisfied");
    if (satisfied !== true) return refuse("Confirm two-step sign-in first.", 403);
  }
  const { data: memberships } = await supabase
    .from("memberships")
    .select("id, organization_id, role")
    .eq("user_id", userId)
    .eq("status", "active")
    .in("role", [...LICENSED]);
  const membership = [...(memberships ?? [])].sort((a, b) => Number(b.role === "firm_owner") - Number(a.role === "firm_owner"))[0];
  if (!membership) return refuse("A licence belongs to a firm owner or licensed consultant.", 403);

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) return refuse("Choose a file.", 400);
  if (bytes.byteLength > LICENCE_PROOF_MAX_BYTES) return refuse("Use a file under 10 MB.", 413);
  const type = licenceProofType(bytes);
  if (!type) return refuse("Use a PDF, JPG or PNG file.", 415);

  const key = licenceProofKey(membership.organization_id, membership.id, randomUUID(), type);
  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return refuse("Uploads are not available right now.", 503);
  }
  const { error } = await service.storage.from(LICENCE_PROOF_BUCKET).upload(key, bytes, { contentType: type, upsert: false });
  if (error) return refuse("The file could not be stored. Try again.", 502);

  return NextResponse.json({
    locator: licenceProofLocator(key),
    name: proofDisplayName(headerName(request.headers.get("x-file-name"))),
    size: bytes.byteLength,
  });
}
