"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { stripeForm } from "@/modules/finance/stripe";

type Result = { error?: string; clientSecret?: string; accountId?: string };

function messageOf(error: { message: string } | null): string {
  const text = error?.message ?? "That billing step didn’t finish.";
  if (/connect account is not enabled/i.test(text)) return "Card payments wait until the firm’s payout account is enabled.";
  if (/cannot be charged on a card|quote is not payable/i.test(text)) return "This document can’t be paid by card.";
  if (/billing access denied/i.test(text)) return "You don’t have billing access for that file.";
  if (/second person/i.test(text)) return "A second billing person has to approve this.";
  if (/plan is quoted/i.test(text)) return "That plan is quoted. It can’t be chosen here.";
  return text.replace(/^ERROR:\s*/, "").slice(0, 240);
}

async function session(organizationId: string) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  return { supabase };
}

function secret(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function amountOf(value: unknown): number | null {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const raw = record?.amount_cents;
  const amount = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(amount) && amount > 0 ? amount : null;
}

export async function createInvoicePaymentIntent(input: {
  organizationId: string;
  invoiceId: string;
}): Promise<Result> {
  if (!isUuid(input.invoiceId)) return { error: "Choose an invoice." };
  const gate = await session(input.organizationId);
  if ("error" in gate) return { error: gate.error };
  const reserved = await gate.supabase.rpc("reserve_card_payment", { p_invoice_id: input.invoiceId });
  if (reserved.error || !reserved.data) return { error: messageOf(reserved.error) };
  const paymentId = reserved.data;
  const payment = await gate.supabase
    .from("payments")
    .select("amount_cents, currency, connected_account_id")
    .eq("id", paymentId)
    .maybeSingle();
  if (payment.error || !payment.data?.connected_account_id) {
    return { error: "Card payments wait until the firm’s payout account is enabled." };
  }
  const stripe = await stripeForm({
    env: process.env,
    path: "/v1/payment_intents",
    idempotencyKey: paymentId,
    stripeAccount: payment.data.connected_account_id,
    body: {
      amount: String(payment.data.amount_cents),
      currency: payment.data.currency,
      "automatic_payment_methods[enabled]": "true",
      "metadata[flow]": "client_fee",
      "metadata[organization_id]": input.organizationId,
      "metadata[invoice_id]": input.invoiceId,
      "metadata[payment_id]": paymentId,
    },
  });
  const intentId = secret(stripe.json.id);
  const clientSecret = secret(stripe.json.client_secret);
  if (!stripe.ok || !intentId || !clientSecret) return { error: "The card form couldn’t be opened." };
  const attached = await gate.supabase.rpc("attach_payment_intent", { p_payment_id: paymentId, p_intent_id: intentId });
  if (attached.error) return { error: messageOf(attached.error) };
  return { clientSecret };
}

export async function createPlatformPaymentIntent(input: {
  organizationId: string;
  planCode: string;
  interval: string;
}): Promise<Result> {
  const gate = await session(input.organizationId);
  if ("error" in gate) return { error: gate.error };
  const selected = await gate.supabase.rpc("select_firm_plan", {
    p_plan_code: input.planCode,
    p_interval: input.interval,
  });
  if (selected.error) return { error: messageOf(selected.error) };
  const amount = amountOf(selected.data);
  const snapshot = selected.data && typeof selected.data === "object" && !Array.isArray(selected.data)
    ? (selected.data as Record<string, unknown>)
    : null;
  const currency = typeof snapshot?.currency === "string" ? snapshot.currency : "";
  if (!amount || !currency) return { error: "That plan has no price in the catalog." };
  const customer = await stripeForm({
    env: process.env,
    path: "/v1/customers",
    idempotencyKey: `firm-customer-${input.organizationId}`,
    body: { "metadata[organization_id]": input.organizationId, "metadata[flow]": "platform_subscription" },
  });
  const customerId = secret(customer.json.id);
  if (!customer.ok || !customerId) return { error: "The plan payment couldn’t be opened." };
  const stripe = await stripeForm({
    env: process.env,
    path: "/v1/payment_intents",
    idempotencyKey: `plan-${input.organizationId}-${input.planCode}-${input.interval}-${amount}`,
    body: {
      amount: String(amount),
      currency,
      customer: customerId,
      "automatic_payment_methods[enabled]": "true",
      "metadata[flow]": "platform_subscription",
      "metadata[organization_id]": input.organizationId,
      "metadata[subscription_id]": `plan-${input.planCode}-${input.interval}`,
    },
  });
  const clientSecret = secret(stripe.json.client_secret);
  if (!stripe.ok || !clientSecret) return { error: "The plan payment couldn’t be opened." };
  return { clientSecret };
}

export async function startConnectOnboarding(input: { organizationId: string }): Promise<Result> {
  const gate = await session(input.organizationId);
  if ("error" in gate) return { error: gate.error };
  const existing = await gate.supabase.from("processor_accounts").select("stripe_account_id").maybeSingle();
  let accountId = existing.data?.stripe_account_id ?? null;
  if (!accountId) {
    const created = await stripeForm({
      env: process.env,
      path: "/v1/accounts",
      idempotencyKey: `connect-${input.organizationId}`,
      body: {
        type: "express",
        country: "CA",
        "capabilities[card_payments][requested]": "true",
        "capabilities[transfers][requested]": "true",
        "metadata[organization_id]": input.organizationId,
      },
    });
    accountId = secret(created.json.id);
    if (!created.ok || !accountId) return { error: "The payout account couldn’t be opened." };
    const saved = await gate.supabase.rpc("upsert_processor_account", { p_stripe_account_id: accountId });
    if (saved.error) return { error: messageOf(saved.error) };
  }
  const sessionResult = await stripeForm({
    env: process.env,
    path: "/v1/account_sessions",
    body: {
      account: accountId,
      "components[account_onboarding][enabled]": "true",
      "components[payouts][enabled]": "true",
    },
  });
  const clientSecret = secret(sessionResult.json.client_secret);
  if (!sessionResult.ok || !clientSecret) return { error: "Payout onboarding couldn’t be opened." };
  return { clientSecret, accountId };
}

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function recordManualPaymentFromSheet(form: FormData) {
  const organizationId = field(form, "organizationId");
  const gate = await session(organizationId);
  if ("error" in gate) return { error: gate.error };
  const { error } = await gate.supabase.rpc("record_manual_payment", {
    p_invoice_id: field(form, "invoiceId"),
    p_amount_cents: Number(field(form, "amountCents")),
    p_method: "bank_transfer",
    p_external_reference: field(form, "reference"),
    p_received_on: field(form, "receivedOn"),
    p_destination: field(form, "destination"),
    p_evidence: field(form, "evidence"),
  });
  if (error) return { error: messageOf(error) };
  return {};
}

export async function verifyManualPaymentFromSheet(form: FormData) {
  const gate = await session(field(form, "organizationId"));
  if ("error" in gate) return { error: gate.error };
  const { error } = await gate.supabase.rpc("verify_manual_payment", { p_payment_id: field(form, "paymentId") });
  if (error) return { error: messageOf(error) };
  return {};
}

export async function proposeTransferFromSheet(form: FormData) {
  const gate = await session(field(form, "organizationId"));
  if ("error" in gate) return { error: gate.error };
  const { error } = await gate.supabase.rpc("propose_earned_transfer", {
    p_invoice_id: field(form, "invoiceId"),
    p_amount_cents: Number(field(form, "amountCents")),
    p_reason: field(form, "reason"),
  });
  if (error) return { error: messageOf(error) };
  return {};
}

export async function approveTransferFromSheet(form: FormData) {
  const gate = await session(field(form, "organizationId"));
  if ("error" in gate) return { error: gate.error };
  const { error } = await gate.supabase.rpc("approve_earned_transfer", {
    p_transfer_id: field(form, "transferId"),
    p_reason: field(form, "reason"),
  });
  if (error) return { error: messageOf(error) };
  return {};
}

export async function recordReconciliationFromSheet(form: FormData) {
  const gate = await session(field(form, "organizationId"));
  if ("error" in gate) return { error: gate.error };
  const { error } = await gate.supabase.rpc("record_reconciliation", {
    p_period_start: field(form, "periodStart"),
    p_period_end: field(form, "periodEnd"),
    p_statement_cents: Number(field(form, "statementCents")),
    p_processor_balance_cents: Number(field(form, "processorCents")),
  });
  if (error) return { error: messageOf(error) };
  return {};
}
