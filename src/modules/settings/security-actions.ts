"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { verifyTotpCode } from "@/lib/auth/verify-totp";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { readIdleMinutes } from "@/modules/security/idle";

/**
 * Settings > Security, Idle sign-out (SEC-01): the firm owner sets how long staff can be idle. The
 * six-digit code is checked first (a fresh step-up); public.set_staff_idle_timeout checks the
 * owner, the step-up and the bounds, and audits the change.
 */
export async function setStaffIdleTimeout(input: { organizationId: string; minutes: number; code: string }): Promise<{ minutes: number } | { error: string }> {
  if (!isUuid(input.organizationId)) return { error: "Choose a firm." };
  const read = readIdleMinutes(input.minutes);
  if ("error" in read) return read;
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." };
  const verified = await verifyTotpCode(supabase, input.code);
  if (!verified.ok) return { error: verified.error };
  const { data, error } = await supabase.rpc("set_staff_idle_timeout", { p_organization_id: input.organizationId, p_minutes: read.minutes });
  if (error) return { error: /5 to 480/.test(error.message) ? "Choose 5 to 480 minutes." : safeAccessError(error.message) };
  return { minutes: typeof data === "number" ? data : read.minutes };
}
