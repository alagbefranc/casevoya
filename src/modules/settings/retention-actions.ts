"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { retentionSaveError } from "./retention";

/**
 * Settings > Retention: the firm owner saves the firm's retention period (years, the firm's own
 * choice) through public.set_firm_retention_policy, which checks owner, step-up and version.
 */
export async function saveRetentionPolicy(input: { organizationId: string; years: number; expectedVersion: number }): Promise<{ version: number } | { error: string }> {
  if (!isUuid(input.organizationId)) return { error: "Choose a firm." };
  if (!Number.isInteger(input.years) || input.years < 1 || input.years > 100) return { error: "Choose 1 to 100 years." };
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) return { error: "Reload the page and try again." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." };
  const { data, error } = await supabase.rpc("set_firm_retention_policy", {
    p_organization_id: input.organizationId,
    p_years: input.years,
    p_expected_version: input.expectedVersion,
  });
  if (error) return { error: retentionSaveError(error.message) ?? safeAccessError(error.message) };
  if (typeof data !== "number") return { error: "The retention period could not be saved." };
  return { version: data };
}
