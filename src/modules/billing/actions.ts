"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { IRCC_FEE_LIST_URL, readFeeListPage } from "@/modules/billing/ircc-fee-list";
import {
  billingError,
  readGovernmentFee,
  readRate,
  readTaxRate,
  readTimeEntry,
  readWriteOff,
  type GovernmentFeeFields,
  type TaxRateFields,
  type TimeFields,
} from "@/modules/billing/present";

/**
 * FIN-06 billing actions, run as the signed-in staff member. The database decides who may do
 * what (security-invoker wrappers over SECURITY DEFINER functions in 20261025140000_fin_billing.sql)
 * and computes every amount; these only read what was typed and say refusals in plain words.
 */

type Result<T extends object = object> = ({ ok: true } & T) | { error: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function staffClient(organizationId: string): Promise<{ supabase: Supabase } | { error: string }> {
  if (!isUuid(organizationId)) return { error: "Choose a firm." };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." };
  return { supabase };
}

function goodKey(key: unknown): key is string {
  return typeof key === "string" && key.length >= 8 && key.length <= 180;
}

function taxName(value: string | null | undefined): string | null {
  const name = (value ?? "").trim();
  return name ? name.slice(0, 80) : null;
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export async function logTime(input: { organizationId: string; today: string } & TimeFields): Promise<Result<{ id: string }>> {
  const read = readTimeEntry(input, input.today);
  if ("error" in read) return read;
  if (!isUuid(read.input.matterId)) return { error: "Choose a matter." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("log_time_entry", {
    p_matter_id: read.input.matterId,
    p_worked_on: read.input.workedOn,
    p_minutes: read.input.minutes,
    p_rate_cents: read.input.rateCents,
    p_description: read.input.description,
    p_billable: read.input.billable,
  });
  if (error) return { error: billingError(error.message) };
  return { ok: true, id: String(data) };
}

export async function startTimer(input: { organizationId: string; matter: string; rate: string; description: string; billable: boolean }): Promise<Result<{ id: string }>> {
  if (!isUuid(input.matter)) return { error: "Choose a matter." };
  const rate = readRate(input.rate);
  if ("error" in rate) return rate;
  const description = input.description.trim();
  if (!description || description.length > 500) return { error: "Say what the time is for (up to 500 characters)." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("start_timer", { p_matter_id: input.matter, p_rate_cents: rate.cents, p_description: description, p_billable: input.billable });
  if (error) return { error: billingError(error.message) };
  return { ok: true, id: String(data) };
}

export async function stopTimer(input: { organizationId: string; entryId: string }): Promise<Result<{ minutes: number }>> {
  if (!isUuid(input.entryId)) return { error: "That timer wasn’t found." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("stop_timer", { p_entry_id: input.entryId });
  if (error) return { error: billingError(error.message) };
  return { ok: true, minutes: Number(data) };
}

export async function discardTime(input: { organizationId: string; entryId: string }): Promise<Result> {
  if (!isUuid(input.entryId)) return { error: "That entry wasn’t found." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error };
  const { error } = await session.supabase.rpc("discard_time_entry", { p_entry_id: input.entryId });
  if (error) return { error: billingError(error.message) };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Drafts: from time, a quote or an instalment
// ---------------------------------------------------------------------------

export async function createTimeInvoice(input: { organizationId: string; matterId: string; due: string; tax: string; idempotencyKey: string }): Promise<Result<{ id: string }>> {
  if (!isUuid(input.matterId)) return { error: "Choose a matter." };
  if (!ISO.test(input.due)) return { error: "Choose a due date." };
  if (!goodKey(input.idempotencyKey)) return { error: "Try again." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("create_time_invoice", {
    p_matter_id: input.matterId,
    p_entry_ids: null,
    p_due_on: input.due,
    p_tax_name: taxName(input.tax),
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) return { error: billingError(error.message) };
  return { ok: true, id: String(data) };
}

export async function createQuoteInvoice(input: { organizationId: string; agreementId: string; due: string; tax: string; idempotencyKey: string }): Promise<Result<{ id: string }>> {
  if (!isUuid(input.agreementId)) return { error: "Choose a quote." };
  if (!ISO.test(input.due)) return { error: "Choose a due date." };
  if (!goodKey(input.idempotencyKey)) return { error: "Try again." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("create_quote_invoice", {
    p_agreement_id: input.agreementId,
    p_due_on: input.due,
    p_tax_name: taxName(input.tax),
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) return { error: billingError(error.message) };
  return { ok: true, id: String(data) };
}

export async function createInstalmentPlan(input: { organizationId: string; agreementId: string; dates: string[] }): Promise<Result<{ id: string }>> {
  if (!isUuid(input.agreementId)) return { error: "Choose a quote." };
  if (!Array.isArray(input.dates) || input.dates.length === 0 || input.dates.length > 12 || input.dates.some((date) => !ISO.test(date))) {
    return { error: "Give a due date for each instalment." };
  }
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("create_instalment_plan", { p_agreement_id: input.agreementId, p_due_dates: input.dates });
  if (error) return { error: billingError(error.message) };
  return { ok: true, id: String(data) };
}

export async function invoiceInstalment(input: { organizationId: string; itemId: string; due: string; tax: string; idempotencyKey: string }): Promise<Result<{ id: string }>> {
  if (!isUuid(input.itemId)) return { error: "That instalment wasn’t found." };
  if (!ISO.test(input.due)) return { error: "Choose a due date." };
  if (!goodKey(input.idempotencyKey)) return { error: "Try again." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("invoice_instalment", {
    p_item_id: input.itemId,
    p_due_on: input.due,
    p_tax_name: taxName(input.tax),
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) return { error: billingError(error.message) };
  return { ok: true, id: String(data) };
}

export async function cancelInstalmentPlan(input: { organizationId: string; planId: string; reason: string }): Promise<Result<{ tasks: number }>> {
  if (!isUuid(input.planId)) return { error: "That plan wasn’t found." };
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) return { error: "Give a reason." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("cancel_instalment_plan", { p_plan_id: input.planId, p_reason: reason });
  if (error) return { error: billingError(error.message) };
  return { ok: true, tasks: Number(data) };
}

// ---------------------------------------------------------------------------
// A draft invoice
// ---------------------------------------------------------------------------

export async function issueDraft(input: { organizationId: string; invoiceId: string; due: string }): Promise<Result<{ number: string }>> {
  if (!isUuid(input.invoiceId)) return { error: "That invoice wasn’t found." };
  if (input.due && !ISO.test(input.due)) return { error: "Choose a due date." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("issue_invoice_draft", { p_invoice_id: input.invoiceId, p_due_on: input.due || null });
  if (error) return { error: billingError(error.message) };
  const number = data && typeof data === "object" && "number" in data ? String((data as { number: unknown }).number) : "";
  return { ok: true, number };
}

export async function discardDraft(input: { organizationId: string; invoiceId: string; reason: string }): Promise<Result> {
  if (!isUuid(input.invoiceId)) return { error: "That invoice wasn’t found." };
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) return { error: "Give a reason." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error };
  const { error } = await session.supabase.rpc("discard_invoice_draft", { p_invoice_id: input.invoiceId, p_reason: reason });
  if (error) return { error: billingError(error.message) };
  return { ok: true };
}

export async function addGovernmentFee(input: { organizationId: string; invoiceId: string; today: string } & GovernmentFeeFields): Promise<Result> {
  if (!isUuid(input.invoiceId)) return { error: "That invoice wasn’t found." };
  const read = readGovernmentFee(input, input.today);
  if ("error" in read) return read;
  if (read.input.referenceId && !isUuid(read.input.referenceId)) return { error: "Choose a fee reference." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error };
  const { error } = await session.supabase.rpc("add_invoice_government_fee", {
    p_invoice_id: input.invoiceId,
    p_reference_id: read.input.referenceId,
    p_name: read.input.name,
    p_amount_cents: read.input.amountCents,
    p_source_url: read.input.url,
    p_checked_on: read.input.checkedOn,
  });
  if (error) return { error: billingError(error.message) };
  return { ok: true };
}

export async function removeLine(input: { organizationId: string; lineId: string }): Promise<Result> {
  if (!isUuid(input.lineId)) return { error: "That line wasn’t found." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error };
  const { error } = await session.supabase.rpc("remove_invoice_line", { p_line_id: input.lineId });
  if (error) return { error: billingError(error.message) };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Write-off
// ---------------------------------------------------------------------------

export async function writeOff(input: { organizationId: string; invoiceId: string; amount: string; reason: string; idempotencyKey: string }): Promise<Result<{ status: string }>> {
  if (!isUuid(input.invoiceId)) return { error: "That invoice wasn’t found." };
  const read = readWriteOff(input, null);
  if ("error" in read) return read;
  if (!goodKey(input.idempotencyKey)) return { error: "Try again." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("write_off_invoice", {
    p_invoice_id: input.invoiceId,
    p_amount_cents: read.input.amountCents,
    p_reason: read.input.reason,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) return { error: billingError(error.message) };
  const status = data && typeof data === "object" && "status" in data ? String((data as { status: unknown }).status) : "";
  return { ok: true, status };
}

// ---------------------------------------------------------------------------
// Tax rates
// ---------------------------------------------------------------------------

export async function addTaxRate(input: { organizationId: string } & TaxRateFields): Promise<Result> {
  const read = readTaxRate(input);
  if ("error" in read) return read;
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error };
  const { error } = await session.supabase.rpc("add_tax_rate", {
    p_org: input.organizationId,
    p_name: read.input.name,
    p_rate_percent: read.input.ratePercent,
    p_effective_from: read.input.from,
    p_effective_to: read.input.to,
    p_approved_by: read.input.approvedBy,
    p_source_note: read.input.note,
  });
  if (error) return { error: billingError(error.message) };
  return { ok: true };
}

export async function endTaxRate(input: { organizationId: string; rateId: string; to: string }): Promise<Result> {
  if (!isUuid(input.rateId)) return { error: "That rate wasn’t found." };
  if (!ISO.test(input.to)) return { error: "Choose the last day the rate applies." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error };
  const { error } = await session.supabase.rpc("end_tax_rate", { p_rate_id: input.rateId, p_effective_to: input.to });
  if (error) return { error: billingError(error.message) };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// IRCC fee list
// ---------------------------------------------------------------------------

/**
 * Reads IRCC's fee list from the server and records each fee with the URL, the retrieval time and
 * the page's SHA-256, pending review by a licensed member. A page that can't be reached or read
 * records nothing.
 */
export async function fetchFeeList(input: { organizationId: string }): Promise<Result<{ rows: number; sha256: string }>> {
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error };
  const read = await readFeeListPage(fetch);
  if ("error" in read) return read;
  const { data, error } = await session.supabase.rpc("record_government_fee_snapshot", {
    p_org: input.organizationId,
    p_source_url: IRCC_FEE_LIST_URL,
    p_retrieved_at: read.retrievedAt,
    p_sha256: read.sha256,
    p_rows: read.rows,
  });
  if (error) return { error: billingError(error.message) };
  return { ok: true, rows: Number(data), sha256: read.sha256 };
}

export async function reviewFeeList(input: { organizationId: string; sha256: string; decision: string; note: string }): Promise<Result<{ rows: number }>> {
  if (!/^[0-9a-f]{64}$/.test(input.sha256)) return { error: "There’s no fee list waiting for review." };
  if (input.decision !== "approved" && input.decision !== "rejected") return { error: "Choose approve or reject." };
  const session = await staffClient(input.organizationId);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("review_government_fee_snapshot", {
    p_org: input.organizationId,
    p_sha256: input.sha256,
    p_decision: input.decision,
    p_note: input.note.trim() || null,
  });
  if (error) return { error: billingError(error.message) };
  return { ok: true, rows: Number(data) };
}
