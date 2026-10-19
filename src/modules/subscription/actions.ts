"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { appOrigin } from "@/lib/email/env";
import { stripeServer } from "@/lib/stripe/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/tenant/context";
import { isInterval, isPaidPlan, readCatalog } from "@/modules/subscription/catalog";
import { createBillingCustomer, createPortalSession, createSubscriptionCheckout, PriceResolutionError, readPriceCache, type PriceCache } from "@/modules/subscription/stripe";
import { subscriptionActionError } from "@/modules/subscription/errors";

/**
 * Settings > Subscription (firm owner, step-up): Stripe Checkout for a plan and the Billing
 * Portal. The database decides first (public.subscription_checkout_allowed /
 * subscription_portal_allowed: owner, step-up, catalog, current state) and records the intent;
 * only then is Stripe called, in TEST mode, with the Prices that already exist in the Casevoya
 * account. Without a Stripe test key the action says so and changes nothing.
 */

export type BillingLink = { url: string } | { error: string; stepUp?: boolean };

const NOT_CONFIGURED = "Casevoya billing isn’t connected to Stripe on this server yet (no test key). Nothing was started.";

async function ownerClient(organizationId: string) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  return { supabase };
}

function refusal(message: string): BillingLink {
  const plain = subscriptionActionError(message);
  if (plain) return { error: plain };
  return { error: safeAccessError(message), stepUp: /step-up/i.test(message) };
}

/** The price-id cache in product_settings, written through the service role when it is configured. */
async function priceCache(supabase: Awaited<ReturnType<typeof createClient>>): Promise<PriceCache | null> {
  const { data } = await supabase.from("product_settings").select("value").eq("key", "subscription.stripe_prices").maybeSingle();
  const cached = readPriceCache(data?.value, "test");
  return {
    get: (key) => cached[key] ?? null,
    put: async (prices) => {
      if (!process.env.SUPABASE_SECRET_KEY) return;
      await createServiceClient().rpc("cache_subscription_stripe_prices", { p_mode: "test", p_prices: prices });
    },
  };
}

export async function startSubscriptionCheckout(input: { organizationId: string; plan: string; interval: string; extraSeats: number }): Promise<BillingLink> {
  if (input.plan === "enterprise") return { error: "Enterprise plans are arranged with Casevoya. There is no checkout for them." };
  if (!isPaidPlan(input.plan)) return { error: "Choose a plan." };
  if (!isInterval(input.interval)) return { error: "Choose monthly or annual billing." };
  const extraSeats = Number(input.extraSeats);
  if (!Number.isInteger(extraSeats) || extraSeats < 0 || extraSeats > 500) return { error: "Extra seats must be 0 to 500." };
  const session = await ownerClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { supabase } = session;
  const { data, error } = await supabase.rpc("subscription_checkout_allowed", {
    p_organization_id: input.organizationId,
    p_plan: input.plan,
    p_interval: input.interval,
    p_extra_seats: extraSeats,
  });
  if (error) return refusal(error.message);
  const allowed = (data ?? {}) as { ok?: boolean; idempotency_key?: string; stripe_customer_id?: string | null; firm_name?: string; billing_email?: string | null; catalog?: unknown };
  const catalog = readCatalog(allowed.catalog);
  if (!allowed.ok || typeof allowed.idempotency_key !== "string" || !catalog) return { error: "The checkout could not be prepared." };
  const stripe = stripeServer();
  if (!stripe) return { error: NOT_CONFIGURED };
  try {
    let customerId = allowed.stripe_customer_id ?? null;
    if (!customerId) {
      customerId = await createBillingCustomer(stripe, { organizationId: input.organizationId, name: allowed.firm_name ?? "Firm", email: allowed.billing_email ?? null });
      const recorded = await supabase.rpc("record_subscription_customer", { p_organization_id: input.organizationId, p_stripe_customer_id: customerId });
      if (recorded.error) return refusal(recorded.error.message);
    }
    const checkout = await createSubscriptionCheckout(stripe, await priceCache(supabase), {
      organizationId: input.organizationId,
      customerId,
      plan: input.plan,
      interval: input.interval,
      extraSeats,
      catalog,
      idempotencyKey: allowed.idempotency_key,
      appOrigin: appOrigin(),
      mode: "test",
    });
    return { url: checkout.url };
  } catch (cause) {
    if (cause instanceof PriceResolutionError) return { error: `${cause.message} Casevoya has been told; nothing was charged.` };
    return { error: "Stripe didn’t answer. Nothing was charged; try again in a moment." };
  }
}

export async function openBillingPortal(input: { organizationId: string }): Promise<BillingLink> {
  const session = await ownerClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("subscription_portal_allowed", { p_organization_id: input.organizationId });
  if (error) return refusal(error.message);
  const allowed = (data ?? {}) as { ok?: boolean; stripe_customer_id?: string };
  if (!allowed.ok || typeof allowed.stripe_customer_id !== "string") return { error: "The billing portal could not be opened." };
  const stripe = stripeServer();
  if (!stripe) return { error: NOT_CONFIGURED };
  try {
    return { url: await createPortalSession(stripe, { customerId: allowed.stripe_customer_id, appOrigin: appOrigin() }) };
  } catch {
    return { error: "Stripe didn’t answer. Try again in a moment." };
  }
}
