"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";

/**
 * The Access grants page's Support access tab (SEC-09). Each call acts as the signed-in user;
 * the database decides: a firm owner with a recent step-up to approve or extend, a firm owner at
 * aal2 to decline or end. The owners' email (EM17) is queued by the database on approval.
 */
export type SupportResult = { ok: true; endsAt?: string } | { error: string; stepUp?: boolean };

function refused(message: string): { error: string; stepUp?: boolean } {
  if (/step-up/i.test(message)) return { error: "Confirm it’s you with your authenticator, then try again.", stepUp: true };
  if (/no longer waiting/i.test(message)) return { error: "That request was already decided." };
  if (/already ended/i.test(message)) return { error: "That support access already ended." };
  if (/240 minutes in all/i.test(message)) return { error: "Support access can last 240 minutes in all. End it and let support ask again if they need longer." };
  if (/5 to 240/i.test(message)) return { error: "Extend by 5 to 240 minutes." };
  if (/reason/i.test(message)) return { error: "Give a reason of at least 3 characters." };
  if (/denied/i.test(message)) return { error: "Only a firm owner can decide support access." };
  return { error: safeAccessError(message) };
}

async function signedIn(organizationId: string) {
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  return claims?.claims?.sub ? supabase : null;
}

export async function approveSupportAccess(input: { organizationId: string; requestId: string }): Promise<SupportResult> {
  if (!isUuid(input.requestId)) return { error: "Choose the request to approve." };
  if (!isUuid(input.organizationId)) return { error: "Choose a firm." };
  const supabase = await signedIn(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { data, error } = await supabase.rpc("approve_support_access_request", { p_id: input.requestId });
  return error ? refused(error.message) : { ok: true, endsAt: typeof data === "string" ? data : undefined };
}

export async function declineSupportAccess(input: { organizationId: string; requestId: string; reason: string }): Promise<SupportResult> {
  if (!isUuid(input.requestId)) return { error: "Choose the request to decline." };
  const reason = (input.reason ?? "").trim();
  if (reason.length < 3 || reason.length > 500) return { error: "Give a reason of at least 3 characters." };
  if (!isUuid(input.organizationId)) return { error: "Choose a firm." };
  const supabase = await signedIn(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { error } = await supabase.rpc("decline_support_access_request", { p_id: input.requestId, p_reason: reason });
  return error ? refused(error.message) : { ok: true };
}

export async function endSupportAccess(input: { organizationId: string; requestId: string }): Promise<SupportResult> {
  if (!isUuid(input.requestId)) return { error: "Choose the support access to end." };
  if (!isUuid(input.organizationId)) return { error: "Choose a firm." };
  const supabase = await signedIn(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { error } = await supabase.rpc("end_support_access", { p_id: input.requestId });
  return error ? refused(error.message) : { ok: true };
}

export async function extendSupportAccess(input: { organizationId: string; requestId: string; minutes?: number }): Promise<SupportResult> {
  if (!isUuid(input.requestId)) return { error: "Choose the support access to extend." };
  if (!isUuid(input.organizationId)) return { error: "Choose a firm." };
  const minutes = input.minutes ?? 30;
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 240) return { error: "Extend by 5 to 240 minutes." };
  const supabase = await signedIn(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { data, error } = await supabase.rpc("extend_support_access", { p_id: input.requestId, p_minutes: minutes });
  return error ? refused(error.message) : { ok: true, endsAt: typeof data === "string" ? data : undefined };
}
