"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isInvitationToken, isStaffInviteRole, normalizeEmail } from "@/lib/auth/invitations";
import { safeAccessError } from "@/lib/auth/step-up";
import { verifyTotpCode } from "@/lib/auth/verify-totp";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { attachStaffInviteEmailLink } from "@/modules/email/invite-link";

export type InviteFormState = { error?: string; link?: string; emailLink?: boolean } | null;

export async function createStaffInvitation(
  _previous: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const role = String(formData.get("role") ?? "");
  const organizationId = String(formData.get("organizationId") ?? "");
  const code = String(formData.get("code") ?? "");
  if (!email) return { error: "Enter a valid email address." };
  if (!isStaffInviteRole(role)) return { error: "Choose a staff role." };
  if (!isUuid(organizationId)) return { error: "Choose a firm." };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." };

  const verified = await verifyTotpCode(supabase, code);
  if (!verified.ok) return { error: verified.error };

  const { data: token, error } = await supabase.rpc("create_staff_invitation", {
    organization_id: organizationId,
    email,
    role,
  });
  if (error || typeof token !== "string" || !isInvitationToken(token)) {
    return { error: safeAccessError(error?.message ?? "") };
  }

  const emailLink = await attachStaffInviteEmailLink(supabase, { organizationId, email, role, token });
  const origin = (await headers()).get("origin") ?? "";
  const path = `/invite/${token}`;
  return { link: origin ? `${origin}${path}` : path, emailLink };
}

export async function revokeInvitation(formData: FormData) {
  const invitationId = String(formData.get("invitationId") ?? "");
  const code = String(formData.get("code") ?? "");
  if (!isUuid(invitationId)) redirect("/app/invitations?error=revoke");

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/sign-in?next=/app/invitations");

  const verified = await verifyTotpCode(supabase, code);
  if (!verified.ok) redirect("/app/invitations?error=code");

  const { error } = await supabase.rpc("revoke_staff_invitation", { invitation_id: invitationId });
  if (error) redirect("/app/invitations?error=revoke");
  redirect("/app/invitations?revoked=1");
}
