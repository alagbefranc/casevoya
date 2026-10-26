"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { voError } from "./errors";
import { VO_VENDOR_TERMS } from "./vendor-terms";

type Result = { ok: true; turnedOn: boolean } | { error: string };

/**
 * The firm owner acknowledges the AI vendor terms panel (AI-06), for the version the page showed,
 * and, from the "turn Vo on" dialog, then turns Vo on with the same switch as Settings > Vo
 * (set_vo_settings). The database records who, when and which version, and refuses to turn Vo on
 * without it; an older version than the current one is refused.
 */
export async function acknowledgeVoVendorTerms(input: { organizationId: string; version: string; turnOn: boolean }): Promise<Result> {
  if (!isUuid(input.organizationId) || typeof input.version !== "string" || typeof input.turnOn !== "boolean") return { error: "Choose the terms to acknowledge." };
  if (input.version !== VO_VENDOR_TERMS.version) return { error: voError("vendor_terms_changed") };
  const supabase = await createClient({ organizationId: input.organizationId });
  const acknowledged = await supabase.rpc("acknowledge_vo_vendor_terms", { p_organization_id: input.organizationId, p_terms_version: input.version });
  if (acknowledged.error) return { error: voError(/terms changed/i.test(acknowledged.error.message) ? "vendor_terms_changed" : "owner_only") };
  if (!input.turnOn) return { ok: true, turnedOn: false };
  const { error } = await supabase.rpc("set_vo_settings", { p_organization_id: input.organizationId, p_changes: { enabled: true } });
  if (error) return { error: voError(/AI vendor terms/i.test(error.message) ? "vendor_terms" : "owner_only") };
  return { ok: true, turnedOn: true };
}
