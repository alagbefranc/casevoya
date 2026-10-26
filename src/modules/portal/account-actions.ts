"use server";

import { enrollAuthenticator, verifyTotpCode as confirmFactor } from "@/app/auth/port-actions";
import type { TotpSetup } from "@/lib/auth/mfa-pending";
import { verifyTotpCode } from "@/lib/auth/verify-totp";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { isPortalConsentPurpose, type PortalConsentPurpose } from "@/modules/portal/account-present";

/**
 * /portal/account (SEC-01, SEC-05): the client's own two-step sign-in and their optional
 * consents. Supabase Auth holds the authenticator; the database records each change and decides.
 */

/** Starts authenticator setup (the same pending setup as /mfa, so a scanned QR keeps working). */
export async function startMyTwoStep(): Promise<TotpSetup | { error: string }> {
  const setup = await enrollAuthenticator();
  return setup ?? { error: "Two-step sign-in couldn’t be started. If it’s already on, reload the page." };
}

/** Confirms the authenticator with its first code, then records that two-step is on. */
export async function confirmMyTwoStep(input: { organizationId: string; factorId: string; code: string }): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(input.organizationId)) return { error: "Choose a firm." };
  const confirmed = await confirmFactor(input.factorId, input.code.replace(/\s/g, ""));
  if (!confirmed?.ok) return { error: "That code didn’t match. Check the time on your phone and try the newest code." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { error } = await supabase.rpc("record_my_two_step", { p_enabled: true });
  if (error) return { error: "Two-step is on, but it couldn’t be recorded. Reload the page." };
  return { ok: true };
}

/** Turning two-step off is a high-risk change: it needs a fresh code first. */
export async function turnOffMyTwoStep(input: { organizationId: string; code: string }): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(input.organizationId)) return { error: "Choose a firm." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." };
  const checked = await verifyTotpCode(supabase, input.code);
  if (!checked.ok) return { error: checked.error };
  const { data: state } = await supabase.rpc("my_two_step_state");
  if (state !== "ok") return { error: "Confirm with a code from your authenticator app first." };
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const factor of factors?.totp ?? []) {
    const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (removed.error) return { error: "Two-step couldn’t be turned off. Try again." };
  }
  const { error } = await supabase.rpc("record_my_two_step", { p_enabled: false });
  if (error) return { error: "Two-step is off, but it couldn’t be recorded. Reload the page." };
  return { ok: true };
}

/** One optional consent, saved at once. A withdrawal starts the firm's impact review. */
export async function setMyConsent(input: { organizationId: string; purpose: PortalConsentPurpose; granted: boolean }): Promise<{ granted: boolean; review: boolean } | { error: string }> {
  if (!isUuid(input.organizationId)) return { error: "Choose a firm." };
  if (!isPortalConsentPurpose(input.purpose) || typeof input.granted !== "boolean") return { error: "That choice can’t be changed here." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." };
  const { data, error } = await supabase.rpc("set_my_consent", { p_purpose: input.purpose, p_granted: input.granted });
  if (error) return { error: "That choice couldn’t be saved. Nothing changed." };
  const row = (data ?? {}) as { granted?: unknown; review_id?: unknown };
  return { granted: row.granted === true, review: typeof row.review_id === "string" };
}
