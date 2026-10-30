"use server";

import { createClient } from "@/lib/supabase/server";
import { stripeLive, stripeServer, stripeServerForMode } from "@/lib/stripe/server";
import { isUuid } from "@/lib/tenant/context";
import { accountCreateParams, ACCOUNT_SESSION_COMPONENTS, retrieveAccountStatus, syncStatusArgs } from "@/modules/finance/stripe-account";
import { financeError, readNewInvoice, readRefund, refundError, type NewInvoiceFields, type RefundFields } from "@/modules/sheet/finance-present";
import { creditError, readCredit, type CreditFields } from "@/modules/finance/credits-present";
import { connectIdempotencyKey, disconnectError, readDisconnect, type UnlinkBlocker } from "@/modules/finance/connect-present";
import { closeOpenRequests, readOpenRequests, type ClosedRequest } from "@/modules/finance/stripe-unlink";

/**
 * The Sheet's finance actions, run as the signed-in staff member. Who may do what is the
 * database's decision (security-invoker wrappers over SECURITY DEFINER functions): invoices need
 * billing access; the Stripe account needs the firm owner with a recent step-up. Stripe is
 * called only after the database has said yes, with the server's key (live in production, test
 * elsewhere; src/modules/finance/keys.ts).
 */

const NOT_CONFIGURED = "Stripe isn’t configured for this environment. Nothing was sent to Stripe.";
const OTHER_MODE = "This firm’s Stripe account was connected in test mode. Disconnect it in Settings › Billing, then connect the firm’s live Stripe account.";
const WRONG_MODE = "Stripe answered in the other mode (test or live). Nothing was changed.";

/** The firm's linked account and the Stripe mode it was connected in (firm owner and finance users can read it). */
async function linkedAccount(supabase: StaffSupabase, organizationId: string): Promise<{ account_id: string; livemode: boolean } | null> {
  const row = await supabase.from("firm_payment_accounts").select("account_id, livemode").eq("organization_id", organizationId).maybeSingle();
  return row.data ? { account_id: row.data.account_id, livemode: row.data.livemode === true } : null;
}

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
 * True when Stripe answered with a refusal (a 4xx), so no refund was made and the reservation can
 * be released. A conflict on the idempotency key, a network error or a 5xx leaves it to expire.
 */
function stripeRefusedRefund(error: unknown): boolean {
  const failure = (typeof error === "object" && error ? error : {}) as { statusCode?: unknown; type?: unknown; rawType?: unknown };
  const status = typeof failure.statusCode === "number" ? failure.statusCode : 0;
  if (status < 400 || status >= 500 || status === 409) return false;
  return failure.type !== "StripeIdempotencyError" && failure.rawType !== "idempotency_error";
}

/**
 * Refunds a card payment, in full or in part (FIN-13), through the firm's connected account
 * (direct charge, so `stripeAccount`). The database first checks billing access, a recent step-up
 * and the refundable remainder; Stripe is called only after that, with an idempotency key from
 * the dialog, so a double click or a retry makes one refund. Before Stripe is called the amount is
 * reserved in the database under that key (app.reserve_invoice_refund), so two refunds at once
 * cannot both pass the refundable cap. The refund is recorded as pending;
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
  input: { paymentId: string; amountCents: number; reason: string | null; idempotencyKey: string; creditId?: string },
): Promise<{ id: string } | { error: string }> {
  const context = await supabase.rpc("invoice_refund_context", { p_payment_id: input.paymentId });
  if (context.error) return { error: refundError(context.error.message) };
  if (!isRefundContext(context.data)) return { error: "The payment wasn’t found." };
  const payment = context.data;
  if (input.amountCents > payment.refundable) return { error: refundError("refund exceeds the amount received") };
  const stripe = stripeServer();
  if (!stripe) return { error: NOT_CONFIGURED };
  // Hold the amount in the database (payment locked, other holds counted) before Stripe is called.
  // A client credit's refund is held against the credit too (credit locked, its holds counted).
  const hold = {
    p_payment_id: input.paymentId,
    p_amount_cents: input.amountCents,
    p_currency: payment.currency,
    p_livemode: stripeLive(),
    p_idempotency_key: input.idempotencyKey,
  };
  const reserved = input.creditId
    ? await supabase.rpc("reserve_client_credit_refund", { ...hold, p_credit_id: input.creditId })
    : await supabase.rpc("reserve_invoice_refund", hold);
  if (reserved.error) {
    const message = reserved.error.message;
    return { error: /credit/i.test(message) ? creditError(message) : refundError(message) };
  }
  if (typeof reserved.data !== "string") return { error: "The refund wasn’t recorded. Try again." };
  const reservationId = reserved.data;
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
          casevoya_refund_reservation_id: reservationId,
        },
      },
      { stripeAccount: payment.account_id, idempotencyKey: `casevoya-refund-${input.idempotencyKey}` },
    );
    refundId = refund.id;
  } catch (error) {
    if (stripeRefusedRefund(error)) await supabase.rpc("release_invoice_refund_reservation", { p_reservation_id: reservationId });
    return { error: stripeRefundError(error) };
  }
  // Best effort: if this fails, recording the refund (here or from Stripe's event) still consumes the hold.
  await supabase.rpc("link_invoice_refund_reservation", { p_reservation_id: reservationId, p_refund_id: refundId });
  const recorded = await supabase.rpc("record_invoice_refund", {
    p_payment_id: input.paymentId,
    p_refund_id: refundId,
    p_amount_cents: input.amountCents,
    p_currency: payment.currency,
    p_reason: input.reason,
    p_livemode: stripeLive(),
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
    creditId: credit.creditId,
  });
  if ("error" in refunded) return refunded;
  const linked = await supabase.rpc("link_client_credit_refund", { p_credit_id: credit.creditId, p_refund_id: refunded.id });
  if (linked.error) return { error: "The card refund was sent to Stripe, but it wasn’t linked to the credit. It still counts against the credit once Stripe confirms it." };
  return { mode: "card" };
}

/**
 * Creates the firm's Stripe connected account (Accounts v2, in the server's Stripe mode) once, and records it.
 * The idempotency key is the firm's id, so a retry never makes a second account.
 */
export async function connectStripeAccount(input: { organizationId: string }): Promise<{ accountId: string } | { error: string }> {
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { supabase } = session;
  const existing = await supabase.rpc("firm_payment_account_for_owner", { p_org: input.organizationId });
  if (existing.error) return { error: financeError(existing.error.message) };
  const live = stripeLive();
  if (typeof existing.data === "string" && existing.data) {
    const link = await linkedAccount(supabase, input.organizationId);
    if (link && link.livemode !== live) return { error: OTHER_MODE };
    return { accountId: existing.data };
  }
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
    if (account.livemode !== live) return { error: WRONG_MODE };
    accountId = account.id;
  } catch {
    return { error: `Stripe didn’t create the account. Check the platform’s Connect settings in the Stripe ${live ? "live" : "test"} Dashboard.` };
  }
  const recorded = await supabase.rpc("record_firm_payment_account", { p_org: input.organizationId, p_account_id: accountId, p_livemode: live });
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
  const live = stripeLive();
  const link = await linkedAccount(session.supabase, input.organizationId);
  if (link && link.livemode !== live) return { error: OTHER_MODE };
  const stripe = stripeServer();
  if (!stripe) return { error: NOT_CONFIGURED };
  try {
    const created = await stripe.accountSessions.create({ account: account.data, components: ACCOUNT_SESSION_COMPONENTS });
    if (created.livemode !== live) return { error: WRONG_MODE };
    return { clientSecret: created.client_secret };
  } catch {
    return { error: "Stripe didn’t open the account session. Try again." };
  }
}

/** Reads the account's capability statuses from Stripe and caches them (firm owner). */
export async function refreshStripeAccount(input: { organizationId: string }): Promise<{ cardPayments: string } | { error: string }> {
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const row = await session.supabase.from("firm_payment_accounts").select("account_id, livemode").eq("organization_id", input.organizationId).maybeSingle();
  if (!row.data) return { error: "Set up the Stripe account first." };
  const live = stripeLive();
  if ((row.data.livemode === true) !== live) return { error: OTHER_MODE };
  const stripe = stripeServer();
  if (!stripe) return { error: NOT_CONFIGURED };
  try {
    const status = await retrieveAccountStatus(stripe, row.data.account_id);
    if (status.livemode !== live) return { error: WRONG_MODE };
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
 * what still runs on the account. The account isn't deleted or rejected at Stripe; Casevoya stops
 * using it. A link made in test mode is cleaned up with the test key even after the server went live.
 *
 * Right after the unlink commits, the payment requests still open on the old account are canceled
 * at Stripe (Stripe-Account header) and the results recorded (rows canceled, audited, a task for
 * the owner when one couldn't be canceled). After, not before: until the database has said yes the
 * account may still be in use, and once the link is gone no new request can start on it, so the
 * list can't grow. If Stripe fails the unlink still stands; the dialog lists what wasn't canceled.
 */
export async function disconnectStripeAccount(input: {
  organizationId: string;
  accountId: string;
  confirmation: string;
  reason: string;
}): Promise<{ ok: true; notCanceled: ClosedRequest[]; taskCreated: boolean } | { blockers: UnlinkBlocker[] } | { error: string }> {
  const read = readDisconnect(input);
  if ("error" in read) return read;
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  // Read before the unlink: the open requests are canceled in the mode the link was made in.
  const link = await linkedAccount(session.supabase, input.organizationId);
  const { data, error } = await session.supabase.rpc("unlink_stripe_account", {
    p_org: input.organizationId,
    p_account_id: input.accountId,
    p_confirmation: read.input.confirmation,
    p_reason: read.input.reason,
  });
  if (error) return { error: disconnectError(error.message) ?? financeError(error.message) };
  const result = data as { unlinked?: unknown; blockers?: unknown; history_id?: unknown; account_id?: unknown; open_requests?: unknown } | null;
  if (result?.unlinked !== true) return { blockers: Array.isArray(result?.blockers) ? (result.blockers as UnlinkBlocker[]) : [] };

  const requests = readOpenRequests(result.open_requests);
  if (!requests.length || typeof result.history_id !== "string" || typeof result.account_id !== "string") return { ok: true, notCanceled: [], taskCreated: false };
  const closed = await closeOpenRequests(stripeServerForMode(link?.livemode ? "live" : "test"), result.account_id, requests);
  const notCanceled = closed.filter((request) => request.result === "failed");
  const recorded = await session.supabase.rpc("record_stripe_unlink_cancellations", {
    p_history_id: result.history_id,
    p_results: closed.map((request) => ({ payment_id: request.payment_id, result: request.result })),
  });
  const taskId = (recorded.data as { task_id?: unknown } | null)?.task_id;
  // If recording fails, Stripe's own payment_intent.canceled events still mark the canceled rows.
  return { ok: true, notCanceled, taskCreated: !recorded.error && typeof taskId === "string" };
}
