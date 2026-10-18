"use server";

import { isInvitationToken } from "@/lib/auth/invitations";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { attachStaffInviteEmailLink } from "@/modules/email/invite-link";
import { inviteRoleFor, readStaffInvite, staffInviteError, type StaffInviteRole } from "@/modules/sheet/staff-present";

/**
 * Staff invitations from the Designer Sheet's Staff tab. Each call acts as the signed-in user:
 * public.create_staff_invitation / revoke_staff_invitation decide (firm owner, aal2 and a recent
 * step-up). Creating an invitation also queues the firm's invitation email in the same
 * transaction (outbox event staff_invitation.email_requested). The private link is sealed and
 * attached to that email here (attachStaffInviteEmailLink); it is also returned once, so the
 * owner has it as a backup. emailLink says whether the email will carry it.
 */

type Invited = { path: string; emailLink: boolean } | { error: string };

async function ownerClient(organizationId: string) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  return { supabase };
}

async function invite(organizationId: string, email: string, role: StaffInviteRole): Promise<Invited> {
  const session = await ownerClient(organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data: token, error } = await session.supabase.rpc("create_staff_invitation", {
    organization_id: organizationId,
    email,
    role,
  });
  if (error) return { error: staffInviteError(error.message) };
  if (typeof token !== "string" || !isInvitationToken(token)) return { error: "The invitation was not created." };
  const emailLink = await attachStaffInviteEmailLink(session.supabase, { organizationId, email, role, token });
  return { path: `/invite/${token}`, emailLink };
}

export async function inviteStaff(input: { organizationId: string; email: string; role: string }): Promise<Invited> {
  const read = readStaffInvite({ email: input.email, role: input.role });
  if ("error" in read) return { error: read.error };
  return invite(input.organizationId, read.input.email, read.input.role);
}

/** A new invitation for the same person and role. The database revokes the unused one. */
export async function resendStaffInvitation(input: { organizationId: string; invitationId: string }): Promise<Invited> {
  if (!isUuid(input.invitationId)) return { error: "Choose an invitation." };
  const session = await ownerClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data: row } = await session.supabase
    .from("invitations")
    .select("email, role, consumed_at, revoked_at")
    .eq("id", input.invitationId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  const role = row ? inviteRoleFor(row.role) : null;
  if (!row || row.consumed_at || row.revoked_at || !role) return { error: "That invitation can’t be sent again. Invite them from Invite staff." };
  return invite(input.organizationId, row.email, role);
}

export async function revokeStaffInvitation(input: { organizationId: string; invitationId: string }): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(input.invitationId)) return { error: "Choose an invitation." };
  const session = await ownerClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { error } = await session.supabase.rpc("revoke_staff_invitation", { invitation_id: input.invitationId });
  if (error) return { error: staffInviteError(error.message) };
  return { ok: true };
}
