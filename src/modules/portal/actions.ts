"use server";

import type Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { stripeServer } from "@/lib/stripe/server";
import { isUuid } from "@/lib/tenant/context";
import { retrieveAccountStatus } from "@/modules/finance/stripe-account";

export type InvoicePaymentResult =
  | { clientSecret: string; stripeAccount: string; amountCents: number; currency: string }
  | { error: string; reason?: "not_configured" | "not_ready" | "processing" | "closed" | "not_earned_fee" | "manual_payment_pending" };

type Context = {
  invoice_id: string;
  organization_id: string;
  number: string;
  amount_due: number;
  currency: string;
  account_id: string | null;
  processing: boolean;
  open_payment_intent_id: string | null;
  attempts: number;
};

const REUSABLE = new Set<Stripe.PaymentIntent.Status>(["requires_payment_method", "requires_confirmation", "requires_action"]);

/**
 * Starts (or resumes) the card payment of one invoice, as the signed-in client. TEST MODE ONLY.
 *
 * A direct charge: the PaymentIntent is created on the firm's connected account (Stripe-Account
 * header), so the firm is the merchant and Stripe takes its fees from the firm
 * (https://docs.stripe.com/connect/direct-charges). No application fee: the product has no
 * platform-fee setting. The idempotency key is the invoice, the balance and the attempt number,
 * so a retry returns the same PaymentIntent. The browser confirms it with the Payment Element;
 * the invoice is marked paid only by the verified webhook, never by the browser.
 */
export async function createInvoicePayment(input: { organizationId: string; invoiceId: string }): Promise<InvoicePaymentResult> {
  if (!isUuid(input.organizationId) || !isUuid(input.invoiceId)) return { error: "Choose an invoice." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." };

  // Earned fees only (FIN-02): an advance for the client (trust) account is refused before Stripe
  // is asked for anything. A trigger on invoice_payments refuses it again.
  const check = await supabase.rpc("invoice_card_checkout_check", { p_invoice_id: input.invoiceId });
  if (check.error) return { error: "This invoice isn’t available." };
  const answer = check.data as { allowed?: unknown; reason?: unknown } | null;
  // FIN-09: a payment the firm recorded by hand waits for verification; don't take it twice.
  if (answer?.allowed !== true && answer?.reason === "manual_payment_pending") {
    return { error: "Your firm is checking a payment you already sent for this invoice. Nothing was charged.", reason: "manual_payment_pending" };
  }
  if (answer?.allowed !== true) {
    return { error: "This invoice is an advance for the client (trust) account, which can’t be paid by card. Nothing was charged.", reason: "not_earned_fee" };
  }

  const read = await supabase.rpc("invoice_payment_context", { p_invoice_id: input.invoiceId });
  if (read.error) {
    if (/not open for payment/i.test(read.error.message)) return { error: "This invoice is already paid or closed.", reason: "closed" };
    return { error: "This invoice isn’t available." };
  }
  const context = read.data as unknown as Context;
  if (context.processing) return { error: "A payment for this invoice is already processing.", reason: "processing" };
  if (!context.account_id) return { error: "Your firm hasn’t finished setting up card payments.", reason: "not_ready" };
  const stripe = stripeServer();
  if (!stripe) return { error: "Card payments aren’t configured. Nothing was charged.", reason: "not_configured" };
  const stripeAccount = context.account_id;
  const currency = context.currency.toLowerCase();

  try {
    const account = await retrieveAccountStatus(stripe, stripeAccount);
    if (account.livemode) return { error: "Card payments aren’t configured. Nothing was charged.", reason: "not_configured" };
    if (account.cardPayments !== "active") return { error: "Your firm hasn’t finished setting up card payments.", reason: "not_ready" };

    if (context.open_payment_intent_id) {
      const open = await stripe.paymentIntents.retrieve(context.open_payment_intent_id, {}, { stripeAccount });
      if (!open.livemode && REUSABLE.has(open.status) && open.amount === context.amount_due && open.currency === currency && open.client_secret) {
        return { clientSecret: open.client_secret, stripeAccount, amountCents: open.amount, currency: context.currency };
      }
    }

    const intent = await stripe.paymentIntents.create(
      {
        amount: context.amount_due,
        currency,
        // Cards and wallets confirm in the page; methods that need a redirect are not offered.
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        // No case details reach the processor (FIN-08).
        description: `Invoice ${context.number}`,
        metadata: {
          casevoya_invoice_id: context.invoice_id,
          casevoya_invoice_number: context.number,
          casevoya_organization_id: context.organization_id,
        },
      },
      {
        stripeAccount,
        idempotencyKey: `casevoya-pi-${context.invoice_id}-${context.amount_due}-${context.attempts}${context.open_payment_intent_id ? `-${context.open_payment_intent_id}` : ""}`,
      },
    );
    if (intent.livemode || !intent.client_secret) return { error: "Card payments aren’t configured. Nothing was charged.", reason: "not_configured" };

    const recorded = await supabase.rpc("record_invoice_payment_intent", {
      p_invoice_id: context.invoice_id,
      p_payment_intent_id: intent.id,
      p_account_id: stripeAccount,
      p_amount_cents: intent.amount,
      p_currency: intent.currency,
      p_application_fee_cents: intent.application_fee_amount ?? 0,
      p_livemode: false,
    });
    if (recorded.error) return { error: "The payment couldn’t be started. Nothing was charged." };
    return { clientSecret: intent.client_secret, stripeAccount, amountCents: intent.amount, currency: context.currency };
  } catch {
    return { error: "Stripe didn’t answer. Nothing was charged; try again." };
  }
}

/** ORG-06: hides one of the signed-in client's own portal notices (public.dismiss_portal_notice). */
export async function dismissPortalNotice(input: { organizationId: string; noticeId: string }): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(input.organizationId) || !isUuid(input.noticeId)) return { error: "That notice couldn’t be found." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { error } = await supabase.rpc("dismiss_portal_notice", { p_notice_id: input.noticeId });
  return error ? { error: "That notice couldn’t be dismissed. Try again." } : { ok: true };
}
