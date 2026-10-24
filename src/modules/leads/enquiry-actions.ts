"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";

/**
 * CRM-01: turns the firm's enquiry page (and its embed) on or off. The database checks the firm
 * owner and the step-up and audits the change.
 */
export async function setEnquiryPageEnabled(input: { organizationId: string; enabled: boolean }): Promise<{ ok: true } | { error: string; stepUp?: boolean }> {
  if (!isUuid(input.organizationId)) return { error: "Choose a firm." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." };
  const { error } = await supabase.rpc("set_enquiry_page_enabled", { p_organization_id: input.organizationId, p_enabled: input.enabled === true });
  if (!error) return { ok: true };
  if (/step-up/i.test(error.message)) return { error: "Confirm it’s you with your authenticator, then try again.", stepUp: true };
  if (/denied|owner/i.test(error.message)) return { error: "Only the firm owner can turn the enquiry page on or off." };
  return { error: safeAccessError(error.message) };
}
