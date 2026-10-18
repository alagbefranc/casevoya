"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { normalizeCollegeId } from "@/modules/firm-onboarding/licence";
import { licenceTypeFor } from "@/modules/sheet/licence-present";

/**
 * The Licences page and the licence-suspended home. Each call acts as the signed-in user; the
 * database decides who may (public.add_consultant_licence, report_licence_change and
 * reassign_consultant_matters_selected: the firm owner or the licence holder, with a recent
 * step-up). Nothing here contacts the CICC register.
 */
export type LicenceResult = { ok: true; count?: number } | { error: string; stepUp?: boolean };

function refused(message: string): { error: string; stepUp?: boolean } {
  if (/step-up/i.test(message)) return { error: "Confirm it’s you with your authenticator, then try again.", stepUp: true };
  if (/already has a licence/i.test(message)) return { error: "That person already has a licence on file." };
  if (/college id/i.test(message)) return { error: "Enter the licence number using letters, digits or hyphens." };
  if (/3 to 1000/i.test(message)) return { error: "Say what changed in a few words." };
  if (/verified licence/i.test(message)) return { error: "The consultant receiving the work needs a verified licence." };
  if (/needs a reason/i.test(message)) return { error: "Add a note of at least 8 characters for the audit log." };
  if (/choose the matters/i.test(message)) return { error: "Choose at least one matter." };
  if (/denied|cannot be reassigned|not this consultant/i.test(message)) return { error: "You can’t make that change." };
  return { error: safeAccessError(message) };
}

type Client = Awaited<ReturnType<typeof createClient>>;

async function signedIn(organizationId: string): Promise<{ supabase: Client } | { error: string }> {
  if (!isUuid(organizationId)) return { error: "Choose a firm." };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." };
  return { supabase };
}

export async function addConsultantLicence(input: { organizationId: string; membershipId: string; regulator: string; collegeId: string }): Promise<LicenceResult> {
  if (!isUuid(input.membershipId)) return { error: "Choose the consultant." };
  const type = licenceTypeFor(input.regulator);
  if (!type) return { error: "Casevoya records CICC licences only." };
  const collegeId = normalizeCollegeId(input.collegeId ?? "");
  if (!collegeId) return { error: "Enter the licence number using letters, digits or hyphens." };
  const session = await signedIn(input.organizationId);
  if ("error" in session) return { error: session.error };
  const { error } = await session.supabase.rpc("add_consultant_licence", {
    p_membership_id: input.membershipId,
    p_licence_type: type,
    p_college_id: collegeId,
  });
  return error ? refused(error.message) : { ok: true };
}

export async function reportLicenceChange(input: { organizationId: string; credentialId: string; detail: string }): Promise<LicenceResult> {
  if (!isUuid(input.credentialId)) return { error: "Choose a licence." };
  const detail = (input.detail ?? "").trim();
  if (detail.length < 3 || detail.length > 1000) return { error: "Say what changed in a few words." };
  const session = await signedIn(input.organizationId);
  if ("error" in session) return { error: session.error };
  const { error } = await session.supabase.rpc("report_licence_change", { p_credential_id: input.credentialId, p_detail: detail });
  return error ? refused(error.message) : { ok: true };
}

export async function reassignMatters(input: {
  organizationId: string;
  fromMembershipId: string;
  toMembershipId: string;
  matterIds: string[];
  reason: string;
}): Promise<LicenceResult> {
  if (!isUuid(input.fromMembershipId) || !isUuid(input.toMembershipId)) return { error: "Choose who receives the work." };
  const matterIds = (input.matterIds ?? []).filter(isUuid);
  if (matterIds.length === 0) return { error: "Choose at least one matter." };
  const reason = (input.reason ?? "").trim();
  if (reason.length < 8 || reason.length > 500) return { error: "Add a note of at least 8 characters for the audit log." };
  const session = await signedIn(input.organizationId);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("reassign_consultant_matters_selected", {
    p_from_membership: input.fromMembershipId,
    p_to_membership: input.toMembershipId,
    p_matter_ids: matterIds,
    p_reason: reason,
  });
  return error ? refused(error.message) : { ok: true, count: typeof data === "number" ? data : matterIds.length };
}
