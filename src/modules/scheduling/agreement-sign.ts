"use server";

import { createClient } from "@/lib/supabase/server";
import { clientEvidence } from "@/modules/agreements/evidence";
import { isBookingRef, signError } from "./agreement-sign-present";

/**
 * Signs a booking's consultation agreement through its private link. Anyone holding the link may
 * sign (the booker needs no login); the database checks the consent, the typed name and that the
 * text signed is the text shown (its hash), records the IP and browser this server saw, and
 * signs it once.
 */
export async function signBookingAgreement(input: { ref: string; name: string; consent: boolean; sha256: string }): Promise<{ ok: true } | { error: string }> {
  if (!isBookingRef(input.ref) || !/^[0-9a-f]{64}$/.test(input.sha256)) return { error: signError("not available") };
  const name = input.name.trim();
  if (name.length < 2) return { error: signError("full name") };
  if (!input.consent) return { error: signError("consent is required") };
  const supabase = await createClient();
  const evidence = await clientEvidence();
  const { error } = await supabase.rpc("sign_booking_agreement", {
    p_ref: input.ref,
    p_name: name.slice(0, 200),
    p_consent: true,
    p_sha256: input.sha256,
    p_ip: evidence.ip,
    p_user_agent: evidence.userAgent,
  });
  return error ? { error: signError(error.message) } : { ok: true };
}
