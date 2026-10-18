"use server";

import { createClient } from "@/lib/supabase/server";
import { stripeServer } from "@/lib/stripe/server";
import { isUuid } from "@/lib/tenant/context";
import { accountCreateParams, ACCOUNT_SESSION_COMPONENTS, retrieveAccountStatus } from "@/modules/finance/stripe-account";
import { financeError, readNewInvoice, type NewInvoiceFields } from "@/modules/sheet/finance-present";

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
