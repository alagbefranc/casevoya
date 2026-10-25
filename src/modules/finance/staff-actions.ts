"use server";

import { createClient } from "@/lib/supabase/server";
import { stripeServer } from "@/lib/stripe/server";
import { isUuid } from "@/lib/tenant/context";
import { accountCreateParams, ACCOUNT_SESSION_COMPONENTS, retrieveAccountStatus, syncStatusArgs } from "@/modules/finance/stripe-account";
import { financeError, readNewInvoice, readRefund, refundError, type NewInvoiceFields, type RefundFields } from "@/modules/sheet/finance-present";
import { creditError, readCredit, type CreditFields } from "@/modules/finance/credits-present";
import { connectIdempotencyKey, disconnectError, readDisconnect, type UnlinkBlocker } from "@/modules/finance/connect-present";

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
  return refundCardPayment(session.supabase, input.organizationId, { ...read.input, idempotencyKey: input.idempotencyKey });
}

type StaffSupabase = Awaited<ReturnType<typeof createClient>>;

/** The one card-refund path (Refund on the Payments tab, and a client credit's Refund to the card). */
async function refundCardPayment(
  supabase: StaffSupabase,
  organizationId: string,
  input: { paymentId: string; amountCents: number; reason: string | null; idempotencyKey: string },
): Promise<{ id: string } | { error: string }> {
  const context = await supabase.rpc("invoice_refund_context", { p_payment_id: input.paymentId });
  if (context.error) return { error: refundError(context.error.message) };
  if (!isRefundContext(context.data)) return { error: "The payment wasn’t found." };
  const payment = context.data;
  if (input.amountCents > payment.refundable) return { error: refundError("refund exceeds the amount received") };
  const stripe = stripeServer();
  if (!stripe) return { error: NOT_CONFIGURED };
  let refundId: string;
  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: payment.payment_intent_id,
        amount: input.amountCents,
        ...(input.reason ? { reason: input.reason as "duplicate" | "fraudulent" | "requested_by_customer" } : {}),
        metadata: {
          casevoya_organization_id: organizationId,
          casevoya_invoice_id: payment.invoice_id,
          casevoya_payment_id: input.paymentId,
        },
      },
      { stripeAccount: payment.account_id, idempotencyKey: `casevoya-refund-${input.idempotencyKey}` },
    );
    refundId = refund.id;
  } catch (error) {
    return { error: stripeRefundError(error) };
  }
  const recorded = await supabase.rpc("record_invoice_refund", {
    p_payment_id: input.paymentId,
    p_refund_id: refundId,
    p_amount_cents: input.amountCents,
    p_currency: payment.currency,
    p_reason: input.reason,
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
 * A client credit (an overpayment, FIN-13): apply it to another open invoice of the same client,
 * refund it to the card that paid (through the same Stripe refund path as the Payments tab, then
 * linked to the credit), or record a bank refund made outside Casevoya. The database checks
 * billing access, a recent step-up, the amount left and, for a bank refund, that no card refund of
 * that invoice is still pending at Stripe. One idempotency key per dialog opening.
 */
export async function moveClientCredit(
  input: { organizationId: string; idempotencyKey: string; today: string; maxCents: number | null } & CreditFields,
): Promise<{ mode: string } | { error: string }> {
  const read = readCredit(input, input.maxCents, input.today);
  if ("error" in read) return { error: read.error };
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 180) {
    return { error: "Try again." };
  }
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { supabase } = session;
  const credit = read.input;
  if (credit.mode === "apply") {
    const { error } = await supabase.rpc("apply_client_credit", {
      p_credit_id: credit.creditId,
      p_target_invoice_id: credit.targetInvoiceId,
      p_amount_cents: credit.amountCents,
      p_idempotency_key: input.idempotencyKey,
    });
    return error ? { error: creditError(error.message) } : { mode: "apply" };
  }
  if (credit.mode === "bank") {
    const { error } = await supabase.rpc("record_client_credit_bank_refund", {
      p_credit_id: credit.creditId,
      p_amount_cents: credit.amountCents,
      p_method: credit.method,
      p_reference: credit.reference,
      p_refunded_on: credit.refundedOn,
      p_idempotency_key: input.idempotencyKey,
    });
    return error ? { error: creditError(error.message) } : { mode: "bank" };
  }
  const context = await supabase.rpc("client_credit_refund_context", { p_credit_id: credit.creditId });
  if (context.error) return { error: creditError(context.error.message) };
  const row = (context.data ?? {}) as { payment_id?: unknown; refundable?: unknown; available?: unknown };
  if (typeof row.payment_id !== "string") return { error: "No card payment on this invoice can take a refund. Record a bank refund instead." };
  if (credit.amountCents > Number(row.available ?? 0)) return { error: creditError("amount is more than the credit available") };
  if (credit.amountCents > Number(row.refundable ?? 0)) return { error: refundError("refund exceeds the amount received") };
  const refunded = await refundCardPayment(supabase, input.organizationId, {
    paymentId: row.payment_id,
    amountCents: credit.amountCents,
    reason: "requested_by_customer",
    idempotencyKey: input.idempotencyKey,
  });
  if ("error" in refunded) return refunded;
  const linked = await supabase.rpc("link_client_credit_refund", { p_credit_id: credit.creditId, p_refund_id: refunded.id });
  if (linked.error) return { error: "The card refund was sent to Stripe, but it wasn’t linked to the credit. It still counts against the credit once Stripe confirms it." };
  return { mode: "card" };
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
  // After a disconnect, a new key: Stripe would otherwise hand back the disconnected account.
  const ended = await supabase.from("firm_payment_account_history").select("id", { count: "exact", head: true }).eq("organization_id", input.organizationId);
  if (ended.error) return { error: "Casevoya couldn’t check the firm’s earlier Stripe accounts. Try again." };
  let accountId: string;
  try {
    const account = await stripe.v2.core.accounts.create(
      accountCreateParams({ organizationId: input.organizationId, displayName: org.data?.display_name ?? "Firm", email: session.email }),
      { idempotencyKey: connectIdempotencyKey(input.organizationId, ended.count ?? 0) },
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
    const { error } = await session.supabase.rpc("sync_firm_payment_account_status", syncStatusArgs(input.organizationId, row.data.account_id, status));
    if (error) return { error: financeError(error.message) };
    return { cardPayments: status.cardPayments };
  } catch {
    return { error: "Stripe didn’t answer. Try again." };
  }
}

/**
 * Disconnects the firm's Stripe account (firm owner, fresh step-up, typed DISCONNECT, a reason):
 * app.unlink_stripe_account ends the link, keeps it in the history and audits it, or refuses with
 * what still runs on the account. Stripe is not called: the account isn't deleted or rejected,
 * Casevoya just stops using it. The firm can then set up a new account. TEST MODE ONLY.
 */
export async function disconnectStripeAccount(input: {
  organizationId: string;
  accountId: string;
  confirmation: string;
  reason: string;
}): Promise<{ ok: true } | { blockers: UnlinkBlocker[] } | { error: string }> {
  const read = readDisconnect(input);
  if ("error" in read) return read;
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("unlink_stripe_account", {
    p_org: input.organizationId,
    p_account_id: input.accountId,
    p_confirmation: read.input.confirmation,
    p_reason: read.input.reason,
  });
  if (error) return { error: disconnectError(error.message) ?? financeError(error.message) };
  const result = data as { unlinked?: unknown; blockers?: unknown } | null;
  if (result?.unlinked === true) return { ok: true };
  return { blockers: Array.isArray(result?.blockers) ? (result.blockers as UnlinkBlocker[]) : [] };
}
