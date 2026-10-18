"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import {
  clientFundsError,
  readClientAccount,
  readDeposit,
  readEntryId,
  readReason,
  readRefundToClient,
  readTransfer,
  type AccountFields,
  type DepositFields,
  type RefundToClientFields,
  type TransferFields,
} from "@/modules/finance/client-funds-present";

/**
 * The Client funds tab's actions, run as the signed-in staff member. Casevoya moves no money: each
 * action records what happened (or is approved to happen) in the firm's own client account. Who may
 * do what, the step-up, maker-checker and the balance rules are the database's decision.
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
  if (error) return { error: clientFundsError(error.message) };
  if (typeof data === "string") return { id: data };
  return { error: "Nothing was saved. Try again." };
}

export async function addClientAccount(input: { organizationId: string } & AccountFields): Promise<Result> {
  const read = readClientAccount(input);
  if ("error" in read) return read;
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("create_client_account", {
    p_org: input.organizationId,
    p_label: read.input.label,
    p_institution: read.input.institution,
    p_last4: read.input.last4,
  });
  return done(data, error);
}

export async function recordClientDeposit(input: { organizationId: string; idempotencyKey: string; today: string } & DepositFields): Promise<Result> {
  const read = readDeposit(input, input.today);
  if ("error" in read) return read;
  if (!validKey(input.idempotencyKey)) return { error: "Try again." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("record_client_deposit", {
    p_client_account_id: read.input.accountId,
    p_matter_id: read.input.matterId,
    p_person_id: read.input.personId,
    p_amount_cents: read.input.amountCents,
    p_currency: "CAD",
    p_method: read.input.method,
    p_reference: read.input.reference,
    p_received_on: read.input.receivedOn,
    p_evidence: read.input.evidence,
    p_idempotency_key: input.idempotencyKey,
  });
  return done(data, error);
}

export async function verifyClientDeposit(input: { organizationId: string; entryId: string }): Promise<Result> {
  const read = readEntryId(input.entryId);
  if ("error" in read) return read;
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("verify_client_deposit", { p_entry_id: read.entryId });
  return done(data, error);
}

export async function rejectClientDeposit(input: { organizationId: string; entryId: string; reason: string }): Promise<Result> {
  const read = readEntryId(input.entryId);
  if ("error" in read) return read;
  const reason = readReason(input.reason);
  if ("error" in reason) return reason;
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("reject_client_deposit", { p_entry_id: read.entryId, p_reason: reason.reason });
  return done(data, error);
}

export async function requestClientTransfer(input: { organizationId: string; idempotencyKey: string } & TransferFields): Promise<Result> {
  const read = readTransfer(input, null);
  if ("error" in read) return read;
  if (!validKey(input.idempotencyKey)) return { error: "Try again." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("request_client_transfer", {
    p_ledger_id: read.input.ledgerId,
    p_invoice_id: read.input.invoiceId,
    p_amount_cents: read.input.amountCents,
    p_note: read.input.note,
    p_idempotency_key: input.idempotencyKey,
  });
  return done(data, error);
}

export async function approveClientTransfer(input: { organizationId: string; entryId: string }): Promise<{ ownSelf: boolean } | { error: string }> {
  const read = readEntryId(input.entryId);
  if ("error" in read) return read;
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("approve_client_transfer", { p_entry_id: read.entryId });
  if (error) return { error: clientFundsError(error.message) };
  const row = data as { owner_self_approved?: unknown } | null;
  return { ownSelf: row?.owner_self_approved === true };
}

export async function declineClientTransfer(input: { organizationId: string; entryId: string; reason: string }): Promise<Result> {
  const read = readEntryId(input.entryId);
  if ("error" in read) return read;
  const reason = readReason(input.reason);
  if ("error" in reason) return reason;
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("decline_client_transfer", { p_entry_id: read.entryId, p_reason: reason.reason });
  return done(data, error);
}

export async function recordClientRefund(input: { organizationId: string; idempotencyKey: string; today: string } & RefundToClientFields): Promise<Result> {
  const read = readRefundToClient(input, input.today, null);
  if ("error" in read) return read;
  if (!validKey(input.idempotencyKey)) return { error: "Try again." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("record_client_refund", {
    p_ledger_id: read.input.ledgerId,
    p_amount_cents: read.input.amountCents,
    p_method: read.input.method,
    p_reference: read.input.reference,
    p_paid_on: read.input.paidOn,
    p_reason: read.input.reason,
    p_idempotency_key: input.idempotencyKey,
  });
  return done(data, error);
}

export async function recordClientFundCorrection(input: { organizationId: string; idempotencyKey: string; entryId: string; reason: string }): Promise<Result> {
  const read = readEntryId(input.entryId);
  if ("error" in read) return read;
  const reason = readReason(input.reason);
  if ("error" in reason) return reason;
  if (!validKey(input.idempotencyKey)) return { error: "Try again." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  const { data, error } = await session.supabase.rpc("record_client_fund_correction", {
    p_entry_id: read.entryId,
    p_reason: reason.reason,
    p_idempotency_key: input.idempotencyKey,
  });
  return done(data, error);
}
