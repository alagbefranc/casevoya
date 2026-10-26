"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { verifyTotpCode } from "@/lib/auth/verify-totp";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { personConsentError, readIdentityMethod, readReviewNote } from "@/modules/sheet/person-consent-present";

/** SEC-05: marks a consent impact review done with a note; its task is completed with it. */
export async function completeConsentReview(input: { organizationId: string; reviewId: string; version: number; note: string }): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(input.organizationId) || !isUuid(input.reviewId) || !Number.isInteger(input.version)) return { error: "Reload the page and try again." };
  const read = readReviewNote(input.note);
  if ("error" in read) return read;
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." };
  const { error } = await supabase.rpc("complete_consent_review", { p_review_id: input.reviewId, p_expected_version: input.version, p_note: read.note });
  if (error) return { error: personConsentError(error.message) ?? safeAccessError(error.message) };
  return { ok: true };
}

/**
 * SEC-01: resets a client's portal two-step after staff confirmed who they are (never email
 * alone). A fresh six-digit code first; public.reset_client_two_step checks the role, the person,
 * the step-up, and audits it.
 */
export async function resetClientTwoStep(input: { organizationId: string; personId: string; method: string; note: string; code: string }): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(input.organizationId) || !isUuid(input.personId)) return { error: "Reload the page and try again." };
  const read = readIdentityMethod(input.method);
  if ("error" in read) return read;
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." };
  const verified = await verifyTotpCode(supabase, input.code);
  if (!verified.ok) return { error: verified.error };
  const note = input.note.trim();
  const { error } = await supabase.rpc("reset_client_two_step", {
    p_organization_id: input.organizationId,
    p_person_id: input.personId,
    p_identity_method: read.method,
    ...(note ? { p_note: note } : {}),
  });
  if (error) return { error: personConsentError(error.message) ?? safeAccessError(error.message) };
  return { ok: true };
}
