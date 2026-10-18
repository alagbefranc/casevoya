"use server";

import { createClient } from "@/lib/supabase/server";
import { stripeServer } from "@/lib/stripe/server";
import { isUuid } from "@/lib/tenant/context";
import { accountCreateParams, ACCOUNT_SESSION_COMPONENTS, retrieveAccountStatus } from "@/modules/finance/stripe-account";
import { financeError, readNewInvoice, readRefund, refundError, type NewInvoiceFields, type RefundFields } from "@/modules/sheet/finance-present";

/**
 * The Sheet's finance actions, run as the signed-in staff member. Who may do what is the
 * database's decision (security-invoker wrappers over SECURITY DEFINER functions): invoices need
 * billing access; the Stripe account needs the firm owner with a recent step-up. Stripe is
 * called only after the database has said yes, and only with the test-mode key.
 */

const NOT_CONFIGURED = "Stripe isn’t configured for this environment. Nothing was sent to Stripe.";

async function staffClient(organizationId: string) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  return { supabase, email: typeof claims.claims.email === "string" ? claims.claims.email : null };
}

export async function createInvoice(
  input: { organizationId: string; idempotencyKey: string; today: string } & NewInvoiceFields,
): Promise<{ id: string } | { error: string }> {
  const read = readNewInvoice(input, input.today);
  if ("error" in read) return { error: read.error };
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 180) {
    return { error: "Try again." };
  }
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("create_invoice", {
    p_matter_id: read.input.matterId,
    p_description: read.input.description,
    p_amount_cents: read.input.amountCents,
    p_currency: read.input.currency,
    p_due_on: read.input.dueOn,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) return { error: financeError(error.message) };
  if (typeof data !== "string") return { error: "The invoice was not saved." };
  return { id: data };
}

type RefundContext = { payment_intent_id: string; account_id: string; currency: string; refundable: number; invoice_id: string; number: string };

function isRefundContext(value: unknown): value is RefundContext {
  const row = value as Partial<RefundContext> | null;
  return Boolean(
    row &&
      typeof row.payment_intent_id === "string" &&
      typeof row.account_id === "string" &&
      typeof row.currency === "string" &&
      typeof row.refundable === "number" &&
      typeof row.invoice_id === "string",
  );
}

/** Stripe's refusal, in the firm's words. Never passes Stripe's message through. */
function stripeRefundError(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (code === "charge_disputed") return "This payment is disputed, so Stripe won’t refund it. The dispute is on the Refunds and disputes tab.";
  if (code === "charge_already_refunded") return "Stripe says this payment is already fully refunded. It shows here once Stripe’s event arrives.";
  if (code === "amount_too_large") return "That’s more than Stripe can refund on this payment.";
  if (code === "balance_insufficient") return "The firm’s Stripe balance can’t cover this refund yet. Nothing was refunded.";
  return "Stripe didn’t make the refund. Nothing was refunded. Try again.";
}

/**
 * Refunds a card payment, in full or in part (FIN-13), through the firm's connected account
 * (direct charge, so `stripeAccount`). The database first checks billing access, a recent step-up
 * and the refundable remainder; Stripe is called only after that, with an idempotency key from
 * the dialog, so a double click or a retry makes one refund. The refund is recorded as pending;
 * only Stripe's signed refund events move it to succeeded or failed, and the invoice with it.
 */
export async function refundPayment(
  input: { organizationId: string; idempotencyKey: string } & RefundFields,
): Promise<{ id: string } | { error: string }> {
  const read = readRefund(input, "CAD", null);
  if ("error" in read) return { error: read.error };
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 180) {
    return { error: "Try again." };
  }
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { supabase } = session;
  const context = await supabase.rpc("invoice_refund_context", { p_payment_id: read.input.paymentId });
  if (context.error) return { error: refundError(context.error.message) };
  if (!isRefundContext(context.data)) return { error: "The payment wasn’t found." };
  const payment = context.data;
  if (read.input.amountCents > payment.refundable) return { error: refundError("refund exceeds the amount received") };
  const stripe = stripeServer();
  if (!stripe) return { error: NOT_CONFIGURED };
  let refundId: string;
  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: payment.payment_intent_id,
        amount: read.input.amountCents,
        ...(read.input.reason ? { reason: read.input.reason as "duplicate" | "fraudulent" | "requested_by_customer" } : {}),
        metadata: {
          casevoya_organization_id: input.organizationId,
          casevoya_invoice_id: payment.invoice_id,
          casevoya_payment_id: read.input.paymentId,
        },
      },
      { stripeAccount: payment.account_id, idempotencyKey: `casevoya-refund-${input.idempotencyKey}` },
    );
    refundId = refund.id;
  } catch (error) {
    return { error: stripeRefundError(error) };
  }
  const recorded = await supabase.rpc("record_invoice_refund", {
    p_payment_id: read.input.paymentId,
    p_refund_id: refundId,
    p_amount_cents: read.input.amountCents,
    p_currency: payment.currency,
    p_reason: read.input.reason,
    p_livemode: false,
    p_idempotency_key: input.idempotencyKey,
  });
  if (recorded.error || typeof recorded.data !== "string") {
    // Stripe has the refund; its signed event records it here.
    return { error: "Stripe accepted the refund, but it wasn’t recorded here yet. It shows on the Refunds and disputes tab when Stripe’s event arrives. Don’t refund it again." };
  }
  return { id: recorded.data };
}

/**
 * Creates the firm's Stripe connected account (Accounts v2, test mode) once, and records it.
 * The idempotency key is the firm's id, so a retry never makes a second account.
 */
export async function connectStripeAccount(input: { organizationId: string }): Promise<{ accountId: string } | { error: string }> {
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { supabase } = session;
  const existing = await supabase.rpc("firm_payment_account_for_owner", { p_org: input.organizationId });
  if (existing.error) return { error: financeError(existing.error.message) };
  if (typeof existing.data === "string" && existing.data) return { accountId: existing.data };
  const stripe = stripeServer();
  if (!stripe) return { error: NOT_CONFIGURED };
  const org = await supabase.from("organizations").select("display_name").eq("id", input.organizationId).maybeSingle();
  let accountId: string;
  try {
    const account = await stripe.v2.core.accounts.create(
      accountCreateParams({ organizationId: input.organizationId, displayName: org.data?.display_name ?? "Firm", email: session.email }),
      { idempotencyKey: `casevoya-connect-${input.organizationId}` },
    );
    if (account.livemode) return { error: "Only a Stripe test-mode account can be connected." };
    accountId = account.id;
  } catch {
    return { error: "Stripe didn’t create the account. Check the platform’s Connect settings in the Stripe test Dashboard." };
  }
  const recorded = await supabase.rpc("record_firm_payment_account", { p_org: input.organizationId, p_account_id: accountId, p_livemode: false });
  if (recorded.error) return { error: financeError(recorded.error.message) };
  return { accountId };
}

/**
 * A fresh Account Session client secret for the Connect embedded components (firm owner, recent
 * step-up). Connect.js calls this again when a session expires.
 */
export async function createAccountSession(input: { organizationId: string }): Promise<{ clientSecret: string } | { error: string }> {
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const account = await session.supabase.rpc("firm_payment_account_for_owner", { p_org: input.organizationId });
  if (account.error) return { error: financeError(account.error.message) };
  if (typeof account.data !== "string" || !account.data) return { error: "Set up the Stripe account first." };
  const stripe = stripeServer();
  if (!stripe) return { error: NOT_CONFIGURED };
  try {
    const created = await stripe.accountSessions.create({ account: account.data, components: ACCOUNT_SESSION_COMPONENTS });
    if (created.livemode) return { error: "Only a Stripe test-mode account can be connected." };
    return { clientSecret: created.client_secret };
  } catch {
    return { error: "Stripe didn’t open the account session. Try again." };
  }
}

/** Reads the account's capability statuses from Stripe and caches them (firm owner). */
export async function refreshStripeAccount(input: { organizationId: string }): Promise<{ cardPayments: string } | { error: string }> {
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const row = await session.supabase.from("firm_payment_accounts").select("account_id").eq("organization_id", input.organizationId).maybeSingle();
  if (!row.data) return { error: "Set up the Stripe account first." };
  const stripe = stripeServer();
  if (!stripe) return { error: NOT_CONFIGURED };
  try {
    const status = await retrieveAccountStatus(stripe, row.data.account_id);
    if (status.livemode) return { error: "Only a Stripe test-mode account can be connected." };
    const { error } = await session.supabase.rpc("sync_firm_payment_account", {
      p_org: input.organizationId,
      p_account_id: row.data.account_id,
      p_card_payments_status: status.cardPayments,
      p_payouts_status: status.payouts,
      p_requirements_due: status.requirementsDue,
    });
    if (error) return { error: financeError(error.message) };
    return { cardPayments: status.cardPayments };
  } catch {
    return { error: "Stripe didn’t answer. Try again." };
  }
}
