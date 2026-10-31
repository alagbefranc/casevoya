"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { clearResetFactors } from "@/modules/auth/mfa-reset-factors";

const PAGE = "/app/two-step-resets";

/**
 * A firm owner approves or denies a staff member's two-step reset request. The database decides
 * who may (an owner of that firm, assured session, never the person who asked) and refuses an
 * expired request; on approve the server then removes the person's factors (Auth admin API).
 */
export async function decideMfaReset(formData: FormData) {
  const id = String(formData.get("requestId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const confirmed = formData.get("confirmed") === "on";
  if (!isUuid(id) || (decision !== "approve" && decision !== "deny")) redirect(`${PAGE}?error=input`);
  const approve = decision === "approve";
  if (approve && !confirmed) redirect(`${PAGE}?error=confirm`);

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect(`/sign-in?next=${PAGE}`);

  const { data, error } = await supabase.rpc("decide_mfa_reset", { p_id: id, p_approve: approve, p_note: null });
  if (error) {
    const message = error.message.toLowerCase();
    redirect(`${PAGE}?error=${message.includes("own reset") ? "self" : message.includes("already") ? "decided" : "decide"}`);
  }
  const result = (data ?? {}) as { status?: string; requester_user_id?: string };
  if (result.status === "expired") redirect(`${PAGE}?error=expired`);
  if (approve && result.requester_user_id) {
    const cleared = await clearResetFactors(id, result.requester_user_id);
    if (!cleared.ok) redirect(`${PAGE}?done=approved&warn=factors`);
  }
  redirect(`${PAGE}?done=${approve ? "approved" : "denied"}`);
}
