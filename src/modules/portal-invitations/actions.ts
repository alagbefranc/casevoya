"use server";

import { isInvitationToken, normalizeEmail } from "@/lib/auth/invitations";
import { safeAccessError } from "@/lib/auth/step-up";
import { verifyTotpCode } from "@/lib/auth/verify-totp";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import type { Json } from "@/types/database.types";
import { isPortalInviteRole, type PortalAcceptPayload, type PortalInviteRole } from "@/modules/portal-invitations/types";

type RpcResult = { ok?: boolean; error?: string; status?: string; token?: string; invitation_id?: string };

function asResult(data: unknown): RpcResult {
  if (data && typeof data === "object" && !Array.isArray(data)) return data as RpcResult;
  return {};
}

async function staffClient(organizationId: string, code: string) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  const verified = await verifyTotpCode(supabase, code);
  if (!verified.ok) return { error: verified.error };
  return { supabase };
}

export async function createPortalInvitation(input: {
  organizationId: string;
  personId: string;
  matterId: string;
  role: string;
  email: string;
  guardianSubjectIds?: string[];
  code: string;
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
  return { token: result.token, invitationId: result.invitation_id ?? null };
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
  return { token: result.token, invitationId: result.invitation_id ?? input.invitationId };
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

function portalError(code: string | undefined): string {
  switch (code) {
    case "real_client_invitations_locked":
      return "Real client invitations stay locked until the firm finishes sample proofs, a good-standing licence check, and an active trial or subscription.";
    case "minor_cannot_hold_login":
      return "A minor cannot hold their own login. Invite a guardian instead.";
    case "date_of_birth_required":
      return "Record a date of birth before sending this invitation.";
    case "guardian_subject_required":
    case "guardian_subject_not_minor":
      return "A guardian invitation needs the minor they act for.";
    case "rate_limited":
      return "Too many attempts. Wait and try again.";
    case "confirmed_email_required":
      return "Confirm the invited email before accepting.";
    case "portal_terms_required":
    case "privacy_notice_required":
      return "The current terms and privacy notice have to be accepted.";
    case "processing_consent_required":
      return "Processing consent is required for this invitation.";
    case "contact_phone_required":
      return "Add a phone number before choosing text reminders.";
    case "invitation_cannot_be_accepted":
      return "This invitation can no longer be used.";
    default:
      return "That action could not be completed.";
  }
}
