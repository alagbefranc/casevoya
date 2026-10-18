"use server";

import { isInvitationToken, normalizeEmail } from "@/lib/auth/invitations";
import { safeAccessError } from "@/lib/auth/step-up";
import { verifyTotpCode } from "@/lib/auth/verify-totp";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import type { Json } from "@/types/database.types";
import { attachInviteEmailLink } from "@/modules/email/invite-link";
import { acceptLink } from "@/modules/sheet/portal-invite";
import { portalError } from "@/modules/portal-invitations/errors";
import { isPortalInviteRole, type PortalAcceptPayload, type PortalInviteRole } from "@/modules/portal-invitations/types";

type RpcResult = { ok?: boolean; error?: string; status?: string; token?: string; invitation_id?: string; expires_at?: string; role?: string };

function asResult(data: unknown): RpcResult {
  if (data && typeof data === "object" && !Array.isArray(data)) return data as RpcResult;
  return {};
}

/**
 * Seals the private accept link into the invitation email (public.attach_invitation_email_link).
 * False when the email will go out without it; the inviter still gets the link back.
 */
async function attachPortalLink(
  supabase: Awaited<ReturnType<typeof createClient>>,
  result: RpcResult,
  fallbackRole: PortalInviteRole | null,
): Promise<boolean> {
  const role = result.role && isPortalInviteRole(result.role) ? result.role : fallbackRole;
  if (!role || !result.token || !result.invitation_id || !isUuid(result.invitation_id)) return false;
  return attachInviteEmailLink(supabase, result.invitation_id, result.token, acceptLink("", role, result.token));
}

/**
 * A null code relies on the session's recent step-up (the Sheet's matter page sends none);
 * the database checks app.mfa_step_up_satisfied() on every invitation either way.
 */
async function staffClient(organizationId: string, code: string | null) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  if (code != null) {
    const verified = await verifyTotpCode(supabase, code);
    if (!verified.ok) return { error: verified.error };
  }
  return { supabase };
}

export async function createPortalInvitation(input: {
  organizationId: string;
  personId: string;
  matterId: string;
  role: string;
  email: string;
  guardianSubjectIds?: string[];
  code: string | null;
}) {
  const email = normalizeEmail(input.email);
  if (!email) return { error: "Enter a valid email address." };
  if (!isPortalInviteRole(input.role)) return { error: "Choose a portal role." };
  if (!isUuid(input.personId) || !isUuid(input.matterId)) return { error: "Choose a person and a matter." };
  const subjects = input.guardianSubjectIds ?? [];
  if (subjects.some((id) => !isUuid(id))) return { error: "Choose the minor this guardian acts for." };
  const session = await staffClient(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };

  const { data, error } = await session.supabase.rpc("create_portal_invitation", {
    p_person_id: input.personId,
    p_matter_id: input.matterId,
    p_role: input.role as PortalInviteRole,
    p_email: email,
    p_guardian_subject_ids: subjects,
  });
  if (error) return { error: safeAccessError(error.message) };
  const result = asResult(data);
  if (!result.ok || !result.token || !isInvitationToken(result.token)) {
    return { error: portalError(result.error) };
  }
  const emailLink = await attachPortalLink(session.supabase, result, input.role as PortalInviteRole);
  return { token: result.token, invitationId: result.invitation_id ?? null, expiresAt: result.expires_at ?? null, emailLink };
}

export async function resendPortalInvitation(input: { organizationId: string; invitationId: string; code: string }) {
  if (!isUuid(input.invitationId)) return { error: "Choose an invitation." };
  const session = await staffClient(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("resend_portal_invitation", {
    p_invitation_id: input.invitationId,
  });
  if (error) return { error: safeAccessError(error.message) };
  const result = asResult(data);
  if (!result.ok || !result.token || !isInvitationToken(result.token)) return { error: portalError(result.error) };
  const emailLink = await attachPortalLink(session.supabase, result, null);
  return { token: result.token, invitationId: result.invitation_id ?? input.invitationId, emailLink };
}

export async function revokePortalInvitation(input: { organizationId: string; invitationId: string; code: string }) {
  if (!isUuid(input.invitationId)) return { error: "Choose an invitation." };
  const session = await staffClient(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("revoke_portal_invitation", {
    p_invitation_id: input.invitationId,
  });
  if (error) return { error: safeAccessError(error.message) };
  const result = asResult(data);
  if (!result.ok) return { error: portalError(result.error) };
  return { ok: true as const };
}

export async function publishPortalPolicy(input: {
  organizationId: string;
  kind: "portal_terms" | "privacy_notice";
  versionLabel: string;
  title: string;
  body: string;
  code: string;
}) {
  const session = await staffClient(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("publish_portal_policy", {
    p_kind: input.kind,
    p_version_label: input.versionLabel,
    p_title: input.title,
    p_body: input.body,
  });
  if (error) return { error: safeAccessError(error.message) };
  if (typeof data !== "string" || !isUuid(data)) return { error: "That policy could not be published." };
  return { id: data };
}

export async function recordPersonSection(input: {
  organizationId: string;
  personId: string;
  matterId: string;
  sectionKey: "passport_bio" | "school_transcript" | "police_certificate" | "shared_family_record" | "private_record";
  summary: string;
  code: string;
}) {
  if (!isUuid(input.personId) || !isUuid(input.matterId)) return { error: "Choose a person and a matter." };
  const session = await staffClient(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("record_person_section", {
    p_person_id: input.personId,
    p_matter_id: input.matterId,
    p_section_key: input.sectionKey,
    p_summary: input.summary,
  });
  if (error) return { error: safeAccessError(error.message) };
  if (typeof data !== "string") return { error: "That section could not be recorded." };
  return { id: data };
}

async function tokenClient(token: string, organizationId?: string | null) {
  if (!isInvitationToken(token)) return { error: "This invitation link is not valid." as const };
  const supabase = await createClient({ organizationId });
  return { supabase };
}

export async function previewPortalInvitation(token: string) {
  const session = await tokenClient(token);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("preview_portal_invitation", { p_token: token });
  if (error) return { error: "This invitation could not be opened." };
  return { preview: data };
}

export async function savePortalInvitationDraft(token: string, draft: Record<string, unknown>) {
  const session = await tokenClient(token);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("save_portal_invitation_draft", {
    p_token: token,
    p_draft: draft as Json,
  });
  if (error) return { error: "That draft could not be saved." };
  const result = asResult(data);
  if (!result.ok) return { error: portalError(result.error) };
  return { ok: true as const };
}

export async function reportPortalInvitationMismatch(token: string) {
  const session = await tokenClient(token);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("report_portal_invitation_mismatch", { p_token: token });
  if (error) return { error: "That report could not be saved." };
  const result = asResult(data);
  if (!result.ok) return { error: portalError(result.error) };
  return { ok: true as const, status: result.status ?? "closed" };
}

export async function declinePortalInvitation(token: string) {
  const session = await tokenClient(token);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("decline_portal_invitation", { p_token: token });
  if (error) return { error: "That invitation could not be declined." };
  const result = asResult(data);
  if (!result.ok) return { error: portalError(result.error) };
  return { ok: true as const };
}

export async function acceptPortalInvitation(token: string, payload: PortalAcceptPayload) {
  const session = await tokenClient(token);
  if ("error" in session) return { error: session.error };
  const { data: claims } = await session.supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in with the invited email first." };
  const { data, error } = await session.supabase.rpc("accept_portal_invitation", {
    p_token: token,
    p_payload: payload as Json,
  });
  if (error) return { error: safeAccessError(error.message) };
  const result = asResult(data);
  if (!result.ok) return { error: portalError(result.error) };
  return { ok: true as const, invitation: data };
}

export async function withdrawSectionShare(input: { organizationId: string; shareId: string }) {
  if (!isUuid(input.organizationId) || !isUuid(input.shareId)) return { error: "Choose a share." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." };
  const { error } = await supabase.rpc("withdraw_section_share", { p_share_id: input.shareId });
  if (error) return { error: "That share could not be withdrawn." };
  return { ok: true as const };
}

export async function saveMyContactPreferences(input: {
  organizationId: string;
  emailNotices: boolean;
  smsNotices: boolean;
  deadlineReminders: boolean;
  locale: "en-CA" | "fr-CA";
}) {
  if (!isUuid(input.organizationId)) return { error: "Choose a firm." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." };
  const { error } = await supabase.rpc("save_my_contact_preferences", {
    p_email_notices: input.emailNotices,
    p_sms_notices: input.smsNotices,
    p_deadline_reminders: input.deadlineReminders,
    p_locale: input.locale,
  });
  if (error) return { error: "Those contact choices could not be saved." };
  return { ok: true as const };
}
