"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";

export type FindIntroResult = { ok: true } | { error: string; stepUp?: boolean };

/**
 * Firm owner turns introductions on or off. Default is off. The database checks the owner
 * and a recent step-up (`public.set_accept_find_introductions`) and writes the audit row.
 * Turning it off stops future sends. It does not delete a lead already created, and it does not email anyone.
 */
export async function setAcceptFindIntroductions(input: { organizationId: string; enabled: boolean }): Promise<FindIntroResult> {
  if (!isUuid(input.organizationId)) return { error: "Choose a firm." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { error: "Sign in first." };
  const { data: member, error: memberError } = await supabase
    .from("memberships")
    .select("role")
    .eq("organization_id", input.organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (memberError || member?.role !== "firm_owner") return { error: "Only the firm owner can change introductions." };
  const { error } = await supabase.rpc("set_accept_find_introductions", { p_enabled: input.enabled === true });
  if (!error) return { ok: true };
  if (/does not exist|schema cache/i.test(error.message)) return { error: "Introductions aren’t available yet. Nothing was changed." };
  if (/step-up/i.test(error.message)) return { error: "Confirm it’s you with your authenticator, then try again.", stepUp: true };
  return { error: safeAccessError(error.message) };
}
