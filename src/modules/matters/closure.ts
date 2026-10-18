import "server-only";
import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";

/** Plain words for a refusal from public.close_matter. Never the database message itself. */
export function closureError(message: string): string {
  if (/closure blocked/i.test(message)) {
    return "Closing is blocked: client funds are held or waiting for verification, or an issued invoice is unpaid. Settle them first; only the firm owner can close with a reviewed reason.";
  }
  if (/retention period/i.test(message)) return "Set your firm’s retention period in Settings before closing a matter.";
  if (/post-decision/i.test(message)) return "A matter closes from the Post decision stage.";
  if (/version conflict/i.test(message)) return "Someone changed this matter since you opened it. Reload and try again.";
  if (/sample mode/i.test(message)) return "This firm is in sample mode; only sample matters can be closed.";
  if (/licen[cs]ed consultant|licence/i.test(message)) return "Closing a matter needs a licensed consultant.";
  if (/needs a reason|reviewed reason/i.test(message)) return "Add a reason. It is kept in the matter’s history.";
  if (/step-up|aal2/i.test(message)) return safeAccessError(message);
  if (/denied|only the firm owner/i.test(message)) return "Your role can’t close this matter.";
  return "The matter was not closed.";
}

/**
 * Closes a post-decision matter (T040, SEC-07): the database checks client funds and unpaid
 * invoices, records the closure with the firm's retention setting, changes the stage and sets
 * the retention date. `overrideReason` is the firm owner's reviewed reason when money is open.
 */
export async function closeMatter(input: { organizationId: string; matterId: string; version: number; reason: string; overrideReason?: string | null }) {
  if (!isUuid(input.organizationId) || !isUuid(input.matterId) || !Number.isInteger(input.version)) return { error: "Choose a matter." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data, error } = await supabase.rpc("close_matter", {
    p_matter_id: input.matterId,
    p_expected_version: input.version,
    p_reason: input.reason,
    p_override_reason: input.overrideReason ?? null,
  });
  if (error) return { error: closureError(error.message) };
  return { closureId: data };
}
