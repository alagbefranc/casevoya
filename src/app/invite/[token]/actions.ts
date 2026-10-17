"use server";

import { redirect } from "next/navigation";
import { isInvitationToken } from "@/lib/auth/invitations";
import { createClient } from "@/lib/supabase/server";

export async function acceptInvitation(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!isInvitationToken(token)) redirect("/invite/invalid");

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    redirect(`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  const { error } = await supabase.rpc("accept_invitation", { token });
  if (error) {
    const code = /aal2/i.test(error.message) ? "mfa" : "rejected";
    redirect(`/invite/${token}?error=${code}`);
  }
  redirect("/app");
}
