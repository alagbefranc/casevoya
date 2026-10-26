"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { stripeServer } from "@/lib/stripe/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/tenant/context";
import { continuityError, deletionError } from "@/modules/sheet/sec-present";
import { scheduleCancelAtPeriodEnd } from "@/modules/subscription/cancel";

/**
 * SEC-07 and SEC-10 actions, each as the signed-in firm owner. The database decides (owner,
 * step-up, eligibility) and audits; these only pass the request on. Approve deletion removes
 * nothing itself: the deletion runner does, later. Cancel subscription asks Stripe (TEST mode
 * only) to cancel at the period end and records Stripe's date with the service role.
 */
export type SecResult<T = true> = { ok: T } | { error: string; stepUp?: boolean };

type Client = Awaited<ReturnType<typeof createClient>>;

async function signedIn(organizationId: string): Promise<{ supabase: Client; userId: string } | { error: string }> {
  if (!isUuid(organizationId)) return { error: "Choose a firm." };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  const sub = claims?.claims?.sub;
  if (typeof sub !== "string") return { error: "Sign in first." };
  return { supabase, userId: sub };
}

function refused(message: string, plain: (message: string) => string | null): { error: string; stepUp?: boolean } {
  if (/step-up|aal2/i.test(message)) return { error: "Confirm it’s you with your authenticator, then try again.", stepUp: true };
  return { error: plain(message) ?? safeAccessError(message) };
}

export async function approveDeletionJob(input: { organizationId: string; matterId: string; reason: string; key: string }): Promise<SecResult<string>> {
  if (!isUuid(input.matterId)) return { error: "Choose a matter." };
  const reason = (input.reason ?? "").trim();
  if (reason.length < 10) return { error: "Give a reason of at least 10 characters." };
  if (reason.length > 1000) return { error: "Keep the reason under 1,000 characters." };
  const key = (input.key ?? "").trim();
  if (key.length < 8 || key.length > 180) return { error: "Reload the page and try again." };
  const session = await signedIn(input.organizationId);
  if ("error" in session) return session;
  const { data, error } = await session.supabase.rpc("approve_deletion_job", { p_matter_id: input.matterId, p_reason: reason, p_idempotency_key: key });
  if (error) return refused(error.message, deletionError);
  return typeof data === "string" ? { ok: data } : { error: "The deletion could not be approved." };
}

const NOT_CONFIGURED = "Casevoya billing isn’t connected to Stripe on this server yet (no test key). Nothing was cancelled.";

export async function cancelSubscription(input: { organizationId: string }): Promise<SecResult<{ cancelAt: string; recorded: boolean }>> {
  const session = await signedIn(input.organizationId);
  if ("error" in session) return session;
  const { data, error } = await session.supabase.rpc("subscription_cancel_allowed", { p_organization_id: input.organizationId });
  if (error) return refused(error.message, continuityError);
  const allowed = (data ?? {}) as { ok?: boolean; stripe_subscription_id?: string; idempotency_key?: string };
  if (!allowed.ok || typeof allowed.stripe_subscription_id !== "string" || typeof allowed.idempotency_key !== "string") return { error: "The cancellation could not be prepared." };
  const stripe = stripeServer();
  if (!stripe) return { error: NOT_CONFIGURED };
  let scheduled: { cancelAt: string; periodEnd: string | null };
  try {
    scheduled = await scheduleCancelAtPeriodEnd(stripe, { subscriptionId: allowed.stripe_subscription_id, idempotencyKey: allowed.idempotency_key });
  } catch {
    return { error: "Stripe didn’t answer. Nothing was cancelled; try again in a moment." };
  }
  // Stripe's own event (customer.subscription.updated) records the same date; this shows it now.
  if (!process.env.SUPABASE_SECRET_KEY) return { ok: { cancelAt: scheduled.cancelAt, recorded: false } };
  const recorded = await createServiceClient().rpc("service_record_subscription_cancel", {
    p_organization_id: input.organizationId,
    p_actor: session.userId,
    p_cancel_at: scheduled.cancelAt,
    p_period_end: scheduled.periodEnd,
  });
  return { ok: { cancelAt: scheduled.cancelAt, recorded: !recorded.error } };
}

export async function chooseEndArrangement(input: { organizationId: string; arrangement: string; transferId: string | null }): Promise<SecResult> {
  if (input.arrangement !== "custodial_archive" && input.arrangement !== "transfer") return { error: "Choose custodial archive or a transfer." };
  if (input.arrangement === "transfer" && !isUuid(input.transferId ?? "")) return { error: "Choose the firm transfer." };
  const session = await signedIn(input.organizationId);
  if ("error" in session) return session;
  const { error } = await session.supabase.rpc("choose_subscription_end_arrangement", {
    p_organization_id: input.organizationId,
    p_arrangement: input.arrangement,
    p_transfer_id: input.arrangement === "transfer" ? input.transferId : null,
  });
  if (error) return refused(error.message, continuityError);
  return { ok: true };
}

/** The full firm export's index (JSON), for the owner to save with the client-file packages. */
export async function firmExportIndex(input: { organizationId: string }): Promise<SecResult<string>> {
  const session = await signedIn(input.organizationId);
  if ("error" in session) return session;
  const { data, error } = await session.supabase.rpc("firm_export_index", { p_organization_id: input.organizationId });
  if (error) return refused(error.message, continuityError);
  return { ok: `${JSON.stringify(data, null, 2)}\n` };
}
