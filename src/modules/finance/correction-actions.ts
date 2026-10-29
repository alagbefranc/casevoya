"use server";

import { createClient } from "@/lib/supabase/server";
import { stripeLive, stripeServer, stripeServerForMode } from "@/lib/stripe/server";
import { isUuid } from "@/lib/tenant/context";
import {
  correctionError,
  readCreditNote,
  readReasonText,
  readReconciliation,
  readSign,
  type CreditNoteFields,
  type ReconciliationFields,
  type SignFields,
} from "@/modules/finance/corrections-present";

/**
 * Voids, credit notes and client-account reconciliations, run as the signed-in staff member. Who may
 * do what, the step-up, maker-checker, the limits and the reconciliation figures are the database's
 * decision. A credit note never moves money; voiding asks Stripe (test mode) to cancel the card
 * payments the client had started, after the database has voided the invoice.
 */

type Result = { id: string } | { error: string };

async function staffClient(organizationId: string) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  return { supabase };
}

function validKey(key: unknown): key is string {
  return typeof key === "string" && key.length >= 8 && key.length <= 180;
}

function done(data: unknown, error: { message: string } | null): Result {
  if (error) return { error: correctionError(error.message) };
  if (typeof data === "string") return { id: data };
  return { error: "Nothing was saved. Try again." };
}

export async function requestCreditNote(input: { organizationId: string; idempotencyKey: string } & CreditNoteFields): Promise<Result> {
  const read = readCreditNote(input, null);
  if ("error" in read) return read;
  if (!validKey(input.idempotencyKey)) return { error: "Try again." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("request_credit_note", {
    p_invoice_id: read.input.invoiceId,
    p_amount_cents: read.input.amountCents,
    p_reason: read.input.reason,
    p_idempotency_key: input.idempotencyKey,
  });
  return done(data, error);
}

export async function issueCreditNote(input: { organizationId: string; creditNoteId: string }): Promise<{ number: string; ownSelf: boolean; creditBalanceCents: number } | { error: string }> {
  if (!isUuid(input.creditNoteId)) return { error: "Choose the credit note." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("issue_credit_note", { p_credit_note_id: input.creditNoteId });
  if (error) return { error: correctionError(error.message) };
  const row = (data ?? {}) as { number?: unknown; owner_self_approved?: unknown; credit_balance_cents?: unknown };
  return {
    number: typeof row.number === "string" ? row.number : "",
    ownSelf: row.owner_self_approved === true,
    creditBalanceCents: Number(row.credit_balance_cents ?? 0) || 0,
  };
}

export async function declineCreditNote(input: { organizationId: string; creditNoteId: string; reason: string }): Promise<Result> {
  if (!isUuid(input.creditNoteId)) return { error: "Choose the credit note." };
  const reason = readReasonText(input.reason);
  if ("error" in reason) return reason;
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("decline_credit_note", { p_credit_note_id: input.creditNoteId, p_reason: reason.reason });
  return done(data, error);
}

/**
 * Voids an issued invoice with nothing allocated. After the database says yes, the card payments the
 * client had started but not completed are canceled in Stripe (the firm's connected
 * account), best effort: a payment that still succeeds is kept on the voided invoice to refund.
 */
export async function voidInvoice(input: { organizationId: string; invoiceId: string; reason: string }): Promise<{ voided: true; canceled: number; notCanceled: number } | { error: string }> {
  if (!isUuid(input.invoiceId)) return { error: "Choose the invoice." };
  const reason = readReasonText(input.reason);
  if ("error" in reason) return reason;
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("void_invoice", { p_invoice_id: input.invoiceId, p_reason: reason.reason });
  if (error) return { error: correctionError(error.message) };
  const row = (data ?? {}) as { cancel?: unknown; account_id?: unknown };
  const intents = Array.isArray(row.cancel) ? row.cancel.filter((id): id is string => typeof id === "string" && /^pi_[A-Za-z0-9]{6,250}$/.test(id)) : [];
  const account = typeof row.account_id === "string" ? row.account_id : null;
  let canceled = 0;
  // The server's mode first; a request opened in test mode before going live is canceled with the test key.
  const clients = intents.length && account ? [stripeServer(), stripeLive() ? stripeServerForMode("test") : null].filter((c) => c !== null) : [];
  if (account) {
    for (const intent of intents) {
      for (const stripe of clients) {
        try {
          await stripe.paymentIntents.cancel(intent, {}, { stripeAccount: account, idempotencyKey: `casevoya-void-${intent}` });
          canceled += 1;
          break;
        } catch {
          // Already canceled, no longer cancellable, or the other mode: Stripe's event decides what is recorded.
        }
      }
    }
  }
  return { voided: true, canceled, notCanceled: intents.length - canceled };
}

export async function prepareReconciliation(input: { organizationId: string; idempotencyKey: string; today: string } & ReconciliationFields): Promise<Result> {
  const read = readReconciliation(input, input.today, null);
  if ("error" in read) return read;
  if (!validKey(input.idempotencyKey)) return { error: "Try again." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("prepare_client_reconciliation", {
    p_client_account_id: read.input.accountId,
    p_statement_date: read.input.statementDate,
    p_statement_balance_cents: read.input.balanceCents,
    p_note: read.input.note,
    p_idempotency_key: input.idempotencyKey,
  });
  return done(data, error);
}

export async function signReconciliation(input: { organizationId: string; reconciliationId: string } & SignFields): Promise<{ status: string; ownSelf: boolean } | { error: string }> {
  if (!isUuid(input.reconciliationId)) return { error: "Choose the reconciliation." };
  const read = readSign(input, null);
  if ("error" in read) return read;
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("sign_client_reconciliation", {
    p_reconciliation_id: input.reconciliationId,
    p_outcome: read.input.outcome,
    p_notes: read.input.notes,
  });
  if (error) return { error: correctionError(error.message) };
  const row = (data ?? {}) as { status?: unknown; owner_self_signed?: unknown };
  return { status: typeof row.status === "string" ? row.status : read.input.outcome, ownSelf: row.owner_self_signed === true };
}

export async function discardReconciliation(input: { organizationId: string; reconciliationId: string; reason: string }): Promise<Result> {
  if (!isUuid(input.reconciliationId)) return { error: "Choose the reconciliation." };
  const reason = readReasonText(input.reason);
  if ("error" in reason) return reason;
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("discard_client_reconciliation", { p_reconciliation_id: input.reconciliationId, p_reason: reason.reason });
  return done(data, error);
}
