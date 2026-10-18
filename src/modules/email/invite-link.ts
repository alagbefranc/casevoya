import "server-only";
import { appOrigin, emailRuntimeConfig } from "@/lib/email/env";
import { invitationTokenHash, sealInviteLink } from "@/modules/email/invite-link-seal";
import type { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

/**
 * Puts the private accept link in the invitation email. The link is sealed here (the database
 * never holds a usable token) and attached to the invitation's pending email event as the
 * signed-in staff member; public.attach_invitation_email_link decides. Returns whether the email
 * will carry the link. Never throws: on any failure the email still goes out, without the link,
 * after 10 minutes, and the inviter still has the link from the app.
 */
export async function attachInviteEmailLink(
  supabase: Awaited<ReturnType<typeof createClient>>,
  invitationId: string,
  token: string,
  path: string,
): Promise<boolean> {
  try {
    const link = `${appOrigin()}${path}`;
    const sealed = await sealInviteLink(emailRuntimeConfig().dispatchSecret, link, invitationId);
    if (!sealed) return false;
    const { data, error } = await supabase.rpc("attach_invitation_email_link", {
      p_invitation_id: invitationId,
      p_sealed: sealed,
      p_token_hash: await invitationTokenHash(token),
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

/**
 * create_staff_invitation returns only the token, so the invitation is found as the newest open
 * one for this firm, email and role (creating it revoked any older one). The database still
 * checks the token hash, so a link can never land on a different invitation's email.
 */
export async function attachStaffInviteEmailLink(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: { organizationId: string; email: string; role: Database["public"]["Enums"]["org_role"]; token: string },
): Promise<boolean> {
  try {
    const { data: row } = await supabase
      .from("invitations")
      .select("id")
      .eq("organization_id", input.organizationId)
      .eq("email", input.email.trim().toLowerCase())
      .eq("role", input.role)
      .is("consumed_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!row?.id) return false;
    return await attachInviteEmailLink(supabase, row.id, input.token, `/invite/${input.token}`);
  } catch {
    return false;
  }
}
