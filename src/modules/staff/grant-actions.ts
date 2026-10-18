"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { readGrantDate } from "@/modules/sheet/grants-present";

/**
 * The Access grants page. Each call acts as the signed-in user; public.create_access_grant and
 * revoke_access_grant decide (firm owner, recent step-up). No email is sent: there is no approved
 * design for a grant notice yet.
 */
export type GrantResult = { ok: true } | { error: string; stepUp?: boolean };

function refused(message: string): { error: string; stepUp?: boolean } {
  if (/step-up/i.test(message)) return { error: "Confirm it’s you with your authenticator, then try again.", stepUp: true };
  if (/portal login/i.test(message)) return { error: "That person needs a portal login before they can be given access." };
  if (/own records/i.test(message)) return { error: "Choose someone other than the person whose records these are." };
  if (/up to a year/i.test(message)) return { error: "Choose an end date from today up to a year ahead." };
  if (/reason/i.test(message)) return { error: "Give a reason of at least 3 characters." };
  if (/sample and real/i.test(message)) return { error: "Practice records and real records can’t share a grant." };
  if (/closed/i.test(message)) return { error: "That matter is closed." };
  if (/not on that matter/i.test(message)) return { error: "That person isn’t on the chosen matter." };
  if (/already revoked/i.test(message)) return { error: "That grant was already revoked." };
  if (/denied/i.test(message)) return { error: "Only a firm owner can give or end access." };
  return { error: safeAccessError(message) };
}

export async function createAccessGrant(input: {
  organizationId: string;
  personId: string;
  matterId: string;
  subjectId: string;
  expires: string;
  reason: string;
}): Promise<GrantResult> {
  if (!isUuid(input.personId)) return { error: "Choose the person who gets access." };
  if (!isUuid(input.matterId) || !isUuid(input.subjectId)) return { error: "Choose what they can see." };
  const expiresOn = readGrantDate(input.expires);
  if (!expiresOn) return { error: "Enter the end date as DD/MM/YYYY." };
  const reason = (input.reason ?? "").trim();
  if (reason.length < 3 || reason.length > 500) return { error: "Give a reason of at least 3 characters." };
  if (!isUuid(input.organizationId)) return { error: "Choose a firm." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." };
  const { error } = await supabase.rpc("create_access_grant", {
    p_grantee_person_id: input.personId,
    p_subject_person_id: input.subjectId,
    p_matter_id: input.matterId,
    p_expires_on: expiresOn,
    p_purpose: reason,
  });
  return error ? refused(error.message) : { ok: true };
}
