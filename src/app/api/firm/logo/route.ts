import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  FIRM_LOGO_BUCKET,
  FIRM_LOGO_MAX_BYTES,
  FIRM_LOGO_PREVIEW_SECONDS,
  FIRM_LOGO_TOO_SMALL,
  firmLogoBigEnough,
  firmLogoKey,
  firmLogoSize,
  firmLogoLocator,
  firmLogoType,
} from "@/modules/firm-onboarding/firm-logo";

function refuse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/**
 * Stores the firm's logo for the caller's own firm. Only the firm owner, signed in with two-step.
 * The body is the raw file. The server checks the bytes (PNG or JPEG), then writes the file with
 * the service role to a private bucket that browsers cannot write to. The branding step saves the
 * returned locator; the preview uses a short-lived signed link.
 */
export async function POST(request: Request) {
  // Cookie-authenticated, so only this site's own pages may post here.
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return refuse("This upload must come from Casevoya.", 403);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > FIRM_LOGO_MAX_BYTES) return refuse("Use a logo under 2 MB.", 413);

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return refuse("Sign in first.", 401);
  const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level?.currentLevel !== "aal2") {
    const { data: satisfied } = await supabase.rpc("session_mfa_satisfied");
    if (satisfied !== true) return refuse("Confirm two-step sign-in first.", 403);
  }
  const { data: membership } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("role", "firm_owner")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (!membership) return refuse("Only the firm owner can change the logo.", 403);

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) return refuse("Choose a file.", 400);
  if (bytes.byteLength > FIRM_LOGO_MAX_BYTES) return refuse("Use a logo under 2 MB.", 413);
  const type = firmLogoType(bytes);
  if (!type) return refuse("Use a PNG or JPG file.", 415);
  // The Branding hint promises at least 256 px; a file whose size can't be read is refused too.
  if (!firmLogoBigEnough(firmLogoSize(bytes, type))) return refuse(FIRM_LOGO_TOO_SMALL, 422);

  const key = firmLogoKey(membership.organization_id, randomUUID(), type);
  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return refuse("Uploads are not available right now.", 503);
  }
  const bucket = service.storage.from(FIRM_LOGO_BUCKET);
  const { error } = await bucket.upload(key, bytes, { contentType: type, upsert: false });
  if (error) return refuse("The logo could not be stored. Try again.", 502);
  const { data: signed } = await bucket.createSignedUrl(key, FIRM_LOGO_PREVIEW_SECONDS);

  return NextResponse.json({ locator: firmLogoLocator(key), previewUrl: signed?.signedUrl ?? null });
}
