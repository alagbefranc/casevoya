"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { readClientAccount, type AccountFields } from "@/modules/finance/client-funds-present";
import {
  manualPaymentError,
  readAdvance,
  readManualPayment,
  readReconItem,
  readReverse,
  type AdvanceFields,
  type ManualPaymentFields,
  type ReconItemFields,
  type ReverseFields,
} from "@/modules/finance/manual-payments-present";

/**
 * Manual payments (FIN-09), the reconciliation workspace's outstanding items (FIN-12) and the firm's
 * bank account records, run as the signed-in staff member. Casevoya moves no money. Who may do what,
 * the step-up, the second person and the amounts are the database's decision.
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
  if (error) return { error: manualPaymentError(error.message) };
  if (typeof data === "string") return { id: data };
  return { error: "Nothing was saved. Try again." };
}

function optionalId(value: string | null | undefined): string | null | false {
  if (!value) return null;
  return isUuid(value) ? value : false;
}

export async function recordManualPayment(
  input: { organizationId: string; idempotencyKey: string; today: string; evidenceVersionId: string | null } & ManualPaymentFields,
): Promise<Result> {
  const evidence = optionalId(input.evidenceVersionId);
  if (evidence === false) return { error: "The evidence file couldn’t be attached. Upload it again." };
  const read = readManualPayment(input, input.today, evidence !== null, null);
  if ("error" in read) return read;
  if (!validKey(input.idempotencyKey)) return { error: "Try again." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("record_invoice_manual_payment", {
    p_invoice_id: read.input.invoiceId,
    p_amount_cents: read.input.amountCents,
    p_method: read.input.method,
    p_reference: read.input.reference,
    p_received_on: read.input.receivedOn,
    p_operating_account_id: read.input.accountId,
    p_evidence_version_id: evidence,
    p_evidence_note: read.input.note,
    p_reviewer_user_id: read.input.reviewerId,
    p_idempotency_key: input.idempotencyKey,
  });
  return done(data, error);
}

export async function verifyManualPayment(input: { organizationId: string; paymentId: string }): Promise<{ selfVerified: boolean; invoiceStatus: string } | { error: string }> {
  if (!isUuid(input.paymentId)) return { error: "Choose the payment." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("verify_invoice_manual_payment", { p_payment_id: input.paymentId });
  if (error) return { error: manualPaymentError(error.message) };
  const row = (data ?? {}) as { self_verified?: unknown; invoice_status?: unknown };
  return { selfVerified: row.self_verified === true, invoiceStatus: typeof row.invoice_status === "string" ? row.invoice_status : "" };
}

export async function rejectManualPayment(input: { organizationId: string; paymentId: string; reason: string }): Promise<Result> {
  if (!isUuid(input.paymentId)) return { error: "Choose the payment." };
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) return { error: "Give a short reason." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("reject_invoice_manual_payment", { p_payment_id: input.paymentId, p_reason: reason });
  return done(data, error);
}

export async function reverseManualPayment(
  input: { organizationId: string; paymentId: string; wasVerified: boolean } & ReverseFields,
): Promise<{ status: string; reopenedCents: number } | { error: string }> {
  if (!isUuid(input.paymentId)) return { error: "Choose the payment." };
  const read = readReverse(input, input.wasVerified);
  if ("error" in read) return read;
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("reverse_invoice_manual_payment", { p_payment_id: input.paymentId, p_outcome: read.input.outcome, p_reason: read.input.reason });
  if (error) return { error: manualPaymentError(error.message) };
  const row = (data ?? {}) as { status?: unknown; reopened_cents?: unknown };
  return { status: typeof row.status === "string" ? row.status : read.input.outcome, reopenedCents: Number(row.reopened_cents ?? 0) || 0 };
}

export async function recordClientAdvance(
  input: { organizationId: string; idempotencyKey: string; today: string; evidenceVersionId: string | null } & AdvanceFields,
): Promise<Result> {
  const evidence = optionalId(input.evidenceVersionId);
  if (evidence === false) return { error: "The evidence file couldn’t be attached. Upload it again." };
  const read = readAdvance(input, input.today, evidence !== null);
  if ("error" in read) return read;
  if (!validKey(input.idempotencyKey)) return { error: "Try again." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("record_client_advance", {
    p_client_account_id: read.input.accountId,
    p_matter_id: read.input.matterId,
    p_person_id: read.input.personId,
    p_amount_cents: read.input.amountCents,
    p_method: read.input.method,
    p_reference: read.input.reference,
    p_received_on: read.input.receivedOn,
    p_evidence_version_id: evidence,
    p_evidence_note: read.input.note,
    p_reviewer_user_id: read.input.reviewerId,
    p_idempotency_key: input.idempotencyKey,
  });
  return done(data, error);
}

export async function addReconciliationItem(input: { organizationId: string; reconciliationId: string; statementDate: string | null } & ReconItemFields): Promise<Result> {
  if (!isUuid(input.reconciliationId)) return { error: "Choose the reconciliation." };
  const read = readReconItem(input, input.statementDate);
  if ("error" in read) return read;
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("add_reconciliation_adjustment", {
    p_reconciliation_id: input.reconciliationId,
    p_kind: read.input.kind,
    p_description: read.input.description,
    p_reference: read.input.reference,
    p_item_date: read.input.itemDate,
    p_amount_cents: read.input.amountCents,
  });
  return done(data, error);
}

export async function removeReconciliationItem(input: { organizationId: string; itemId: string }): Promise<Result> {
  if (!isUuid(input.itemId)) return { error: "Choose the item." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("remove_reconciliation_adjustment", { p_adjustment_id: input.itemId });
  return done(data, error);
}

/** Settings > Subscription's bank accounts: the firm owner adds the client (trust) or the operating account. */
export async function addBankAccount(input: { organizationId: string; kind: "client" | "operating" } & AccountFields): Promise<Result> {
  const read = readClientAccount(input);
  if ("error" in read) return read;
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const args = { p_org: input.organizationId, p_label: read.input.label, p_institution: read.input.institution, p_last4: read.input.last4 };
  const { data, error } =
    input.kind === "operating" ? await session.supabase.rpc("create_firm_operating_account", args) : await session.supabase.rpc("create_client_account", args);
  return done(data, error);
}
