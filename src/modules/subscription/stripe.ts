import Stripe from "stripe";
import { secretList, verifyStripeEvent, type WebhookSecrets } from "@/modules/finance/webhook-verify";
import type { Json } from "@/types/database.types";
import {
  extraSeatsCents,
  isInterval,
  isPaidPlan,
  parseLookupKey,
  planLookupKey,
  planPriceCents,
  seatLookupKey,
  type Catalog,
  type Interval,
  type PaidPlan,
  type Plan,
} from "@/modules/subscription/catalog";

/**
 * Casevoya's own subscription on the Stripe PLATFORM account (the server's Stripe mode; FIN-01: separate
 * from the firms' connected accounts and from client money). Three parts:
 *   1. Event summaries for the billing webhook: a verified Stripe event becomes a small JSON the
 *      database applies (public.apply_stripe_subscription_event). Ids, status, amounts, dates;
 *      never a card, address or full customer object.
 *   2. The webhook handler (signature with Web Crypto, 2xx/5xx like the Connect webhook).
 *   3. Checkout and the Billing Portal: the Prices exist already in the Casevoya Stripe account
 *      (lookup keys casevoya_<plan>_<interval>, casevoya_seat_<interval>); the app resolves them by
 *      key, checks the amount against the catalog and never creates a Product or Price.
 */

export const BILLING_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  // Card trial: Stripe's notice three days before a trial ends, and a payment the bank wants confirmed.
  "customer.subscription.trial_will_end",
  "invoice.payment_action_required",
]);

export const ORGANIZATION_METADATA = "casevoya_organization_id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9]{6,250}$/;

export type SubscriptionSummary = {
  id: string | null;
  status: string | null;
  plan: Plan | null;
  interval: Interval | null;
  extra_seats: number | null;
  current_period_end: string | null;
  cancel_at: string | null;
  canceled_at: string | null;
  /** Checkout events only: the session's payment_status (paid, unpaid, no_payment_required). */
  payment_status?: string | null;
  /** Card trial: Stripe's trial dates and whether the subscription ends at the period end. */
  trial_start?: string | null;
  trial_end?: string | null;
  cancel_at_period_end?: boolean;
  /** Checkout events only: the session started a free trial (session metadata casevoya_trial). */
  trial?: boolean;
  /**
   * Trialing subscriptions only: SHA-256 (hex) of the card's Stripe fingerprint, added by the
   * webhook route so the database can refuse a second trial on the same card. Never the card.
   */
  card_hash?: string | null;
};

export type InvoiceSummary = {
  id: string;
  /** The Stripe subscription the invoice belongs to, when it has one. */
  subscription: string | null;
  billing_reason: string | null;
  number: string | null;
  status: string | null;
  amount_due: number;
  amount_paid: number;
  amount_remaining: number;
  currency: string;
  period_start: string | null;
  period_end: string | null;
  hosted_invoice_url: string | null;
  pdf_url: string | null;
  created: string | null;
};

export type BillingEventSummary = {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  organization_id: string | null;
  customer: string | null;
  subscription?: SubscriptionSummary;
  invoice?: InvoiceSummary;
};

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : typeof value.id === "string" ? value.id : null;
}

function iso(seconds: unknown): string | null {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

function organizationOf(metadata: Stripe.Metadata | null | undefined): string | null {
  const value = metadata?.[ORGANIZATION_METADATA];
  return typeof value === "string" && UUID.test(value) ? value : null;
}

function url(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("https://") && value.length <= 2000 ? value : null;
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value ? value.slice(0, max) : null;
}

/** Plan, interval and extra seats from the subscription's items (by lookup key) and its metadata. */
export function subscriptionSummary(subscription: Stripe.Subscription): SubscriptionSummary {
  let plan: Plan | null = null;
  let interval: Interval | null = null;
  let extraSeats: number | null = null;
  let periodEnd: string | null = null;
  for (const item of subscription.items?.data ?? []) {
    const parsed = parseLookupKey(item.price?.lookup_key);
    if (parsed?.kind === "plan") {
      plan = parsed.plan;
      interval = parsed.interval;
    } else if (parsed?.kind === "seat") {
      extraSeats = typeof item.quantity === "number" ? Math.max(0, Math.floor(item.quantity)) : 0;
      interval ??= parsed.interval;
    }
    periodEnd ??= iso(item.current_period_end);
  }
  const meta = subscription.metadata ?? {};
  if (!plan && (isPaidPlan(meta.casevoya_plan) || meta.casevoya_plan === "enterprise")) plan = meta.casevoya_plan as Plan;
  if (!interval && isInterval(meta.casevoya_interval)) interval = meta.casevoya_interval;
  if (extraSeats === null && plan && !subscription.items?.data?.some((item) => parseLookupKey(item.price?.lookup_key)?.kind === "seat")) extraSeats = 0;
  return {
    id: subscription.id ?? null,
    status: text(subscription.status, 40),
    plan,
    interval,
    extra_seats: extraSeats,
    current_period_end: periodEnd,
    cancel_at: iso(subscription.cancel_at),
    canceled_at: iso(subscription.canceled_at),
    trial_start: iso(subscription.trial_start),
    trial_end: iso(subscription.trial_end),
    cancel_at_period_end: subscription.cancel_at_period_end === true,
  };
}

/**
 * The summary for one platform event, or null when it is not a billing event we apply. A
 * connected-account event (`event.account`) is never a platform subscription event.
 */
export function billingEventSummary(event: Stripe.Event): BillingEventSummary | null {
  if (!BILLING_EVENTS.has(event.type) || typeof event.account === "string") return null;
  const base = { id: event.id, type: event.type, created: event.created, livemode: event.livemode === true };
  const object = event.data.object as { object?: string };
  if (event.type.startsWith("checkout.session.")) {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.object !== "checkout.session" || session.mode !== "subscription") return null;
    const meta = session.metadata ?? {};
    const seats = Number(meta.casevoya_extra_seats);
    return {
      ...base,
      livemode: base.livemode || session.livemode === true,
      organization_id: organizationOf(session.metadata),
      customer: idOf(session.customer),
      subscription: {
        id: idOf(session.subscription),
        status: text(session.status, 40),
        plan: isPaidPlan(meta.casevoya_plan) ? meta.casevoya_plan : null,
        interval: isInterval(meta.casevoya_interval) ? meta.casevoya_interval : null,
        extra_seats: Number.isInteger(seats) && seats >= 0 ? seats : null,
        current_period_end: null,
        cancel_at: null,
        canceled_at: null,
        payment_status: text(session.payment_status, 40),
        trial: meta.casevoya_trial === "1",
      },
    };
  }
  if (event.type.startsWith("customer.subscription.")) {
    if (object.object !== "subscription") return null;
    const subscription = event.data.object as Stripe.Subscription;
    return {
      ...base,
      livemode: base.livemode || subscription.livemode === true,
      organization_id: organizationOf(subscription.metadata),
      customer: idOf(subscription.customer),
      subscription: subscriptionSummary(subscription),
    };
  }
  if (object.object !== "invoice") return null;
  const invoice = event.data.object as Stripe.Invoice;
  if (typeof invoice.id !== "string") return null;
  const subscriptionMetadata = invoice.parent?.subscription_details?.metadata ?? null;
  const invoiceSubscription = idOf(invoice.parent?.subscription_details?.subscription);
  return {
    ...base,
    livemode: base.livemode || invoice.livemode === true,
    organization_id: organizationOf(subscriptionMetadata) ?? organizationOf(invoice.metadata),
    customer: idOf(invoice.customer),
    invoice: {
      id: invoice.id,
      subscription: invoiceSubscription && SUBSCRIPTION_ID.test(invoiceSubscription) ? invoiceSubscription : null,
      billing_reason: text(invoice.billing_reason, 60),
      number: text(invoice.number, 60),
      status: text(invoice.status, 40),
      amount_due: Math.max(0, invoice.amount_due ?? 0),
      amount_paid: Math.max(0, invoice.amount_paid ?? 0),
      amount_remaining: Math.max(0, invoice.amount_remaining ?? 0),
      currency: text(invoice.currency, 3) ?? "cad",
      period_start: iso(invoice.period_start),
      period_end: iso(invoice.period_end),
      hosted_invoice_url: url(invoice.hosted_invoice_url),
      pdf_url: url(invoice.invoice_pdf),
      created: iso(invoice.created),
    },
  };
}

export type ApplyResult = { outcome: string } & Record<string, unknown>;

export type BillingWebhookDeps = {
  /** The billing destinations' signing secrets (live and test); any one may sign a delivery. */
  secret: WebhookSecrets;
  /** The server's Stripe mode: only events of this mode are applied. Defaults to test. */
  livemode?: boolean;
  apply: ((summary: BillingEventSummary) => Promise<ApplyResult>) | null;
  cryptoProvider?: Stripe.CryptoProvider;
  /**
   * Card trial: the hashed fingerprint of a trialing subscription's card (see SubscriptionSummary
   * card_hash). Best effort: null or a failure applies the event without it.
   */
  cardHash?: (subscription: Stripe.Subscription) => Promise<string | null>;
  /**
   * Card trial: the same hash for the subscription a paid trial Checkout created, looked up by id
   * (the session carries no card). Best effort, like cardHash.
   */
  checkoutCardHash?: (subscriptionId: string) => Promise<string | null>;
  /** Card trial: ends a repeat trial now (the database answered end_trial with the subscription id). */
  endTrial?: (subscriptionId: string) => Promise<void>;
  /**
   * Cancels a second subscription the firm paid for while another was live (the database answered
   * cancel_subscription). A failure answers 5xx so Stripe retries the delivery.
   */
  cancelSubscription?: (subscriptionId: string) => Promise<void>;
};

export type WebhookResponse = { status: number; body: Record<string, unknown> };

/**
 * Verifies and applies one delivery. 2xx tells Stripe to stop retrying: a verified event that is
 * not ours, a duplicate, an event of the other Stripe mode. 5xx makes Stripe retry.
 */
export async function handleBillingWebhook(body: string, signature: string | null, deps: BillingWebhookDeps): Promise<WebhookResponse> {
  const secrets = secretList(deps.secret);
  if (!secrets.length || !deps.apply) return { status: 503, body: { error: "Stripe billing webhooks are not configured." } };
  if (!signature) return { status: 400, body: { error: "Missing Stripe-Signature." } };
  const event = await verifyStripeEvent(body, signature, secrets, deps.cryptoProvider);
  if (!event) return { status: 400, body: { error: "Invalid signature." } };
  // The other mode's destination (test while live, or the reverse): verified, not applied.
  if ((event.livemode === true) !== (deps.livemode === true)) return { status: 200, body: { received: true, outcome: "ignored", reason: "livemode" } };
  const summary = billingEventSummary(event);
  if (!summary) return { status: 200, body: { received: true, outcome: "ignored" } };
  if (summary.subscription && deps.cardHash && event.type.startsWith("customer.subscription.") && summary.subscription.status === "trialing") {
    try {
      const hash = await deps.cardHash(event.data.object as Stripe.Subscription);
      if (hash && /^[0-9a-f]{64}$/.test(hash)) summary.subscription.card_hash = hash;
    } catch {
      // Applied without it: the licence check still runs and a later event carries the card.
    }
  }
  const checkoutSubscription = summary.subscription?.id ?? null;
  if (summary.subscription && deps.checkoutCardHash && event.type.startsWith("checkout.session.") && summary.subscription.trial === true && checkoutSubscription && SUBSCRIPTION_ID.test(checkoutSubscription)) {
    try {
      const hash = await deps.checkoutCardHash(checkoutSubscription);
      if (hash && /^[0-9a-f]{64}$/.test(hash)) summary.subscription.card_hash = hash;
    } catch {
      // Applied without it: the licence claim is still recorded.
    }
  }
  let result: ApplyResult;
  try {
    result = await deps.apply(summary);
  } catch {
    return { status: 500, body: { error: "The event was not recorded." } };
  }
  const endTrial = typeof result.end_trial === "string" && SUBSCRIPTION_ID.test(result.end_trial) ? result.end_trial : null;
  if (endTrial && deps.endTrial) {
    try {
      await deps.endTrial(endTrial);
    } catch {
      // Recorded either way; a repeat trial left running is visible in the audit (repeat_trial).
    }
  }
  const cancel = typeof result.cancel_subscription === "string" && SUBSCRIPTION_ID.test(result.cancel_subscription) ? result.cancel_subscription : null;
  if (cancel) {
    if (!deps.cancelSubscription) return { status: 503, body: { error: "A duplicate subscription could not be cancelled." } };
    try {
      await deps.cancelSubscription(cancel);
    } catch {
      // Stripe retries the delivery; the database repeats the instruction until the subscription ends.
      return { status: 500, body: { error: "A duplicate subscription could not be cancelled." } };
    }
  }
  return { status: 200, body: { received: true, outcome: result.outcome } };
}

/** SHA-256 (hex) of "card:" + a Stripe card fingerprint, the value subscription_trial_claims holds. */
export async function cardFingerprintHash(fingerprint: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`card:${fingerprint}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The summary as the database RPC takes it. */
export function summaryJson(summary: BillingEventSummary): Json {
  return JSON.parse(JSON.stringify(summary)) as Json;
}

// ---------------------------------------------------------------------------
// Checkout and the Billing Portal
// ---------------------------------------------------------------------------

/** The slice of the Stripe client these helpers use; tests pass fakes. */
export type BillingStripe = {
  customers: {
    create(params: Stripe.CustomerCreateParams, options?: Stripe.RequestOptions): Promise<{ id: string }>;
    retrieve?(id: string): Promise<{ id: string; deleted?: unknown; metadata?: Stripe.Metadata | null }>;
  };
  prices: { list(params: Stripe.PriceListParams): Promise<{ data: Pick<Stripe.Price, "id" | "unit_amount" | "currency" | "lookup_key" | "active" | "recurring">[] }> };
  checkout: { sessions: { create(params: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions): Promise<{ id: string; url: string | null }> } };
  billingPortal: { sessions: { create(params: Stripe.BillingPortal.SessionCreateParams): Promise<{ url: string }> } };
};

export type PriceCache = {
  /** Price ids by lookup key, as product_settings subscription.stripe_prices holds them for this mode. */
  get: (lookupKey: string) => string | null;
  /** Called once with every key resolved from Stripe in this run; best effort. */
  put: (prices: Record<string, string>) => Promise<void>;
};

/** Reads one mode's map from the subscription.stripe_prices JSON. */
export function readPriceCache(value: unknown, mode: "test" | "live"): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const map = (value as Record<string, unknown>)[mode];
  if (!map || typeof map !== "object" || Array.isArray(map)) return {};
  const out: Record<string, string> = {};
  for (const [key, id] of Object.entries(map as Record<string, unknown>)) {
    if (parseLookupKey(key) && typeof id === "string" && /^price_[A-Za-z0-9]{6,250}$/.test(id)) out[key] = id;
  }
  return out;
}

export class PriceResolutionError extends Error {}

/**
 * The Stripe Price for a lookup key: from the cache, else listed by lookup key (active only). The
 * amount and currency must match the catalog, or the checkout stops: the app never guesses a price.
 */
export async function resolvePrice(
  stripe: BillingStripe,
  cache: PriceCache | null,
  lookupKey: string,
  expected: { cents: number; currency: string; interval: Interval },
  resolved: Record<string, string>,
): Promise<string> {
  const cached = cache?.get(lookupKey);
  if (cached) return cached;
  const listed = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  const price = listed.data.find((row) => row.lookup_key === lookupKey && row.active !== false);
  if (!price) throw new PriceResolutionError(`Stripe has no active price for ${lookupKey}.`);
  if (price.unit_amount !== expected.cents || (price.currency ?? "").toLowerCase() !== expected.currency.toLowerCase() || price.recurring?.interval !== expected.interval) {
    throw new PriceResolutionError(`The Stripe price for ${lookupKey} does not match the catalog.`);
  }
  resolved[lookupKey] = price.id;
  return price.id;
}

export type CheckoutInput = {
  organizationId: string;
  customerId: string;
  plan: PaidPlan;
  interval: Interval;
  extraSeats: number;
  catalog: Catalog;
  idempotencyKey: string;
  appOrigin: string;
  mode: "test" | "live";
  /**
   * Card trial: the free days Checkout grants (subscription_checkout_allowed decides), or the end
   * of a trial the firm already started. None: billing starts today.
   */
  trial?: { days?: number | null; endAt?: string | null } | null;
  /** The founding-firm coupon (25% for 12 months), when the offer is open, and its terms. */
  foundingCoupon?: string | null;
  founding?: { percent: number; months: number } | null;
  /** The firm's time zone, for the date in the disclosure. */
  timeZone?: string | null;
};

/** The trial's last day and the trial_end Stripe takes, or null when billing starts today. */
export function checkoutTrial(trial: CheckoutInput["trial"], now = new Date()): { end: Date; days: number | null; endSeconds: number | null } | null {
  if (!trial) return null;
  if (typeof trial.days === "number" && Number.isInteger(trial.days) && trial.days >= 1 && trial.days <= 730) {
    return { end: new Date(now.getTime() + trial.days * 86_400_000), days: trial.days, endSeconds: null };
  }
  const at = trial.endAt ? new Date(trial.endAt) : null;
  // Stripe wants trial_end at least 48 hours out; a shorter remainder bills today.
  if (at && Number.isFinite(at.getTime()) && at.getTime() - now.getTime() > 49 * 3_600_000) {
    return { end: at, days: null, endSeconds: Math.floor(at.getTime() / 1000) };
  }
  return null;
}

function money(cents: number, currency: string): string {
  const amount = (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
  return `${currency.toUpperCase()} ${amount}`;
}

/**
 * The words above Checkout's button: what is charged today, what is charged when, and how to stop
 * it. Stripe shows its own trial line too; this one names the date, the amount and the taxes.
 */
export function checkoutDisclosure(input: { cents: number; currency: string; interval: Interval; trialEnd: Date | null; founding: { percent: number; months: number } | null; timeZone?: string | null }): string {
  const discounted = input.founding ? Math.round((input.cents * (100 - input.founding.percent)) / 100) : input.cents;
  const per = input.interval === "year" ? "year" : "month";
  const price = input.founding
    ? `${money(discounted, input.currency)}/${per} (founding-firm price, ${input.founding.percent}% off for the first ${input.founding.months} months), then ${money(input.cents, input.currency)}/${per}`
    : `${money(input.cents, input.currency)}/${per}`;
  const taxes = "plus applicable taxes";
  if (!input.trialEnd) return `You are billed ${price}, ${taxes}, starting today. Cancel anytime in Settings > Subscription.`;
  let date: string;
  try {
    date = new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeZone: input.timeZone || "America/Toronto" }).format(input.trialEnd);
  } catch {
    date = new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeZone: "America/Toronto" }).format(input.trialEnd);
  }
  return `$0 today. Your free trial ends on ${date}; then this card is billed ${price}, ${taxes}, unless you cancel before then. Cancel anytime in Settings > Subscription. One free trial per firm, card and licence.`;
}

/** True for Stripe's refusal of a coupon (spent, expired or missing), so Checkout opens without it. */
export function couponRefused(cause: unknown): boolean {
  const error = cause as { code?: unknown; param?: unknown } | null;
  const param = typeof error?.param === "string" ? error.param : "";
  return error?.code === "coupon_expired" || param.startsWith("discounts") || (error?.code === "resource_missing" && param.includes("coupon"));
}

/** Where Checkout and the portal come back to: the Subscription tab. */
export function billingReturnUrl(appOrigin: string, outcome?: "success" | "cancelled"): string {
  return `${appOrigin}/sheet/settings?tab=billing${outcome ? `&checkout=${outcome}` : ""}`;
}

/**
 * A Checkout Session (mode subscription) for the plan and extra seats. Line items come from the
 * Prices Stripe already holds; metadata on the session and on the subscription names the firm so
 * every later event finds it.
 */
export async function createSubscriptionCheckout(stripe: BillingStripe, cache: PriceCache | null, input: CheckoutInput): Promise<{ url: string; id: string }> {
  const planCents = planPriceCents(input.catalog, input.plan, input.interval);
  if (planCents === null) throw new PriceResolutionError("The catalog has no price for that plan.");
  const resolved: Record<string, string> = {};
  const currency = input.catalog.currency;
  const planPrice = await resolvePrice(stripe, cache, planLookupKey(input.plan, input.interval), { cents: planCents, currency, interval: input.interval }, resolved);
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [{ price: planPrice, quantity: 1 }];
  if (input.extraSeats > 0) {
    const seatCents = extraSeatsCents(input.catalog, input.interval, 1);
    if (seatCents === null) throw new PriceResolutionError("The catalog has no price for extra seats.");
    const seatPrice = await resolvePrice(stripe, cache, seatLookupKey(input.interval), { cents: seatCents, currency, interval: input.interval }, resolved);
    lineItems.push({ price: seatPrice, quantity: input.extraSeats });
  }
  if (cache && Object.keys(resolved).length) {
    try {
      await cache.put(resolved);
    } catch {
      // The cache is a convenience: the next run lists the price again.
    }
  }
  const metadata: Stripe.MetadataParam = {
    [ORGANIZATION_METADATA]: input.organizationId,
    casevoya_plan: input.plan,
    casevoya_interval: input.interval,
    casevoya_extra_seats: String(input.extraSeats),
  };
  const trial = checkoutTrial(input.trial);
  const sessionMetadata: Stripe.MetadataParam = { ...metadata, casevoya_trial: trial ? "1" : "0" };
  const seatTotal = input.extraSeats > 0 ? (extraSeatsCents(input.catalog, input.interval, input.extraSeats) ?? 0) : 0;
  const cents = planCents + seatTotal;
  const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
    metadata,
    ...(trial
      ? {
          ...(trial.days ? { trial_period_days: trial.days } : { trial_end: trial.endSeconds ?? undefined }),
          // No card at the trial's end (removed in the portal): the subscription cancels, never bills.
          trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
        }
      : {}),
  };
  const params = (coupon: string | null): Stripe.Checkout.SessionCreateParams => ({
    mode: "subscription",
    customer: input.customerId,
    line_items: lineItems,
    success_url: billingReturnUrl(input.appOrigin, "success"),
    cancel_url: billingReturnUrl(input.appOrigin, "cancelled"),
    metadata: sessionMetadata,
    subscription_data: subscriptionData,
    client_reference_id: input.organizationId,
    // Card trial: a card even when today's total is $0; the address Stripe Tax needs.
    payment_method_collection: "always",
    billing_address_collection: "required",
    customer_update: { address: "auto", name: "auto" },
    automatic_tax: { enabled: true },
    tax_id_collection: { enabled: true },
    ...(coupon ? { discounts: [{ coupon }] } : {}),
    custom_text: {
      submit: {
        message: checkoutDisclosure({
          cents,
          currency,
          interval: input.interval,
          trialEnd: trial?.end ?? null,
          founding: coupon ? (input.founding ?? null) : null,
          timeZone: input.timeZone,
        }),
      },
    },
  });
  const coupon = input.foundingCoupon && /^[A-Za-z0-9_-]{1,64}$/.test(input.foundingCoupon) ? input.foundingCoupon : null;
  let session: { id: string; url: string | null };
  try {
    session = await stripe.checkout.sessions.create(params(coupon), { idempotencyKey: `casevoya-checkout-${input.idempotencyKey}` });
  } catch (cause) {
    if (!coupon || !couponRefused(cause)) throw cause;
    // The founding offer is spent (50 firms) or withdrawn: the firm checks out at the list price.
    session = await stripe.checkout.sessions.create(params(null), { idempotencyKey: `casevoya-checkout-${input.idempotencyKey}-list` });
  }
  if (!session.url) throw new Error("Stripe returned no Checkout URL.");
  return { url: session.url, id: session.id };
}

/** The firm's Stripe customer on the platform account; one per firm, keyed by the firm id. */
export async function createBillingCustomer(stripe: BillingStripe, input: { organizationId: string; name: string; email: string | null }): Promise<string> {
  const customer = await stripe.customers.create(
    { name: input.name, ...(input.email ? { email: input.email } : {}), metadata: { [ORGANIZATION_METADATA]: input.organizationId } },
    { idempotencyKey: `casevoya-customer-${input.organizationId}` },
  );
  return customer.id;
}

/**
 * Whether the stored customer exists in the server's Stripe mode. False only when Stripe says it
 * doesn't (a test-mode customer after the server went live, or a deleted one); any other failure
 * is thrown, so a Stripe outage never replaces a firm's customer.
 */
export async function billingCustomerExists(stripe: BillingStripe, customerId: string): Promise<boolean> {
  if (!stripe.customers.retrieve) return true;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    return customer.deleted !== true;
  } catch (cause) {
    const code = (cause as { code?: unknown } | null)?.code;
    if (code === "resource_missing") return false;
    throw cause;
  }
}

/**
 * Whether the customer exists in this Stripe mode and names this firm in its metadata (the server
 * creates every billing customer with it). Checked before the customer id is recorded for a firm.
 */
export async function billingCustomerOfFirm(stripe: BillingStripe, customerId: string, organizationId: string): Promise<boolean> {
  if (!stripe.customers.retrieve) return false;
  const customer = await stripe.customers.retrieve(customerId);
  return customer.deleted !== true && customer.id === customerId && customer.metadata?.[ORGANIZATION_METADATA] === organizationId;
}

/** The portal configuration named by STRIPE_BILLING_PORTAL_CONFIGURATION (bpc_…), or Stripe's default. */
export function portalConfiguration(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.STRIPE_BILLING_PORTAL_CONFIGURATION?.trim() ?? "";
  return /^bpc_[A-Za-z0-9]{6,250}$/.test(value) ? value : null;
}

/** A Billing Portal session: payment method, seats, cancel at period end, invoices. */
export async function createPortalSession(stripe: BillingStripe, input: { customerId: string; appOrigin: string; configuration?: string | null }): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({
    customer: input.customerId,
    return_url: billingReturnUrl(input.appOrigin),
    ...(input.configuration ? { configuration: input.configuration } : {}),
  });
  return session.url;
}
