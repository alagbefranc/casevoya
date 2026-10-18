import { safeAccessError } from "@/lib/auth/step-up";
import { isInvoiceCurrency, normalizeCurrency, parseAmount } from "@/modules/finance/money";

/** Finance page and invoice wording that does not depend on the database. */

export const INVOICE_DIALOG = "invoice";

export type InvoiceTone = "blue" | "ok" | "unv" | "chg" | "bad" | "rev" | "gr";

export const REFUND_DIALOG = "refund";

type State = { tone: InvoiceTone; label: string; detail?: string };

/**
 * The state badge and the filter chip token for an invoice. Overdue is derived, never stored.
 * `refunded` ("CAD 130.00") is what succeeded refunds returned: a partly refunded invoice keeps
 * its paid state and says how much went back; a fully refunded one is "Refunded" (FIN-13).
 */
export function invoiceState(
  status: string,
  dueOn: string,
  today: string,
  processing = false,
  refunded: string | null = null,
): State & { flag: string } {
  const open = status === "issued" || status === "partially_paid";
  const detail = refunded ? { detail: `${refunded} refunded` } : {};
  if (open && processing) return { tone: "rev", label: "Payment processing", flag: status === "issued" ? "issued" : "partial" };
  if (open && dueOn < today) return { tone: "bad", label: "Overdue", flag: "overdue" };
  switch (status) {
    case "draft":
      return { tone: "gr", label: "Draft", flag: "draft" };
    case "issued":
      return { tone: "blue", label: "Issued", flag: "issued" };
    case "partially_paid":
      return { tone: "chg", label: "Partially paid", flag: "partial", ...detail };
    case "paid":
      return { tone: "ok", label: "Paid", flag: "paid", ...detail };
    case "refunded":
      return { tone: "gr", label: "Refunded", flag: "closed" };
    case "voided":
      return { tone: "gr", label: "Voided", flag: "closed" };
    case "credited":
      return { tone: "gr", label: "Credited", flag: "closed" };
    default:
      return { tone: "gr", label: status, flag: "" };
  }
}

/**
 * The Payments tab's state badge for a card payment (`invoice_payment_status`). Only verified
 * Stripe events move a payment, so the badge says what Stripe confirmed. `requires_payment`
 * (the client opened the card form, nothing was charged) is not listed on the tab. A received
 * payment that succeeded refunds returned in full reads "Refunded"; in part, "Received" with the
 * refunded amount (`refunded`, formatted).
 */
export function paymentState(status: string, refund: { refundedCents: number; receivedCents: number; refunded: string } | null = null): State {
  if (status === "succeeded" && refund && refund.refundedCents > 0) {
    if (refund.refundedCents >= refund.receivedCents) return { tone: "gr", label: "Refunded" };
    return { tone: "ok", label: "Received", detail: `${refund.refunded} refunded` };
  }
  switch (status) {
    case "succeeded":
      return { tone: "ok", label: "Received" };
    case "processing":
      return { tone: "rev", label: "Processing" };
    case "failed":
      return { tone: "bad", label: "Payment failed" };
    case "canceled":
      return { tone: "gr", label: "Canceled" };
    case "requires_payment":
      return { tone: "gr", label: "Not paid yet" };
    default:
      return { tone: "gr", label: status };
  }
}

/** Payment statuses the Payments tab lists: a charge was attempted or settled. */
export const LISTED_PAYMENT_STATUSES = ["processing", "succeeded", "failed", "canceled"] as const;

/** "evt_…3xY9Qa" for a Stripe id: the prefix and the last six characters, enough to find it in Stripe. */
export function shortStripeId(id: string | null | undefined): string {
  const value = (id ?? "").trim();
  if (!value) return "—";
  const cut = value.indexOf("_");
  const prefix = cut > 0 ? value.slice(0, cut + 1) : "";
  const rest = value.slice(prefix.length);
  return rest.length > 8 ? `${prefix}…${rest.slice(-6)}` : value;
}

export const FEE_CATEGORY_LABEL: Record<string, string> = {
  professional_fee: "Professional fee",
  disbursement: "Disbursement",
  consultation_fee: "Consultation fee",
};

export type NewInvoiceFields = { matter: string; description: string; amount: string; currency: string; due: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Checks the New invoice dialog before it is sent. The database checks everything again. */
export function readNewInvoice(fields: NewInvoiceFields, today: string):
  | { input: { matterId: string; description: string; amountCents: number; currency: string; dueOn: string } }
  | { error: string } {
  if (!UUID.test(fields.matter)) return { error: "Choose the matter to invoice." };
  const description = fields.description.trim();
  if (!description) return { error: "Describe the delivered work or incurred cost." };
  if (description.length > 500) return { error: "Keep the description under 500 characters." };
  const currency = normalizeCurrency(fields.currency) ?? "";
  if (!isInvoiceCurrency(currency)) return { error: "Invoices are in CAD for now." };
  const amountCents = parseAmount(fields.amount, currency);
  if (amountCents === null) return { error: "Enter the amount, like 1130.00." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.due)) return { error: "Choose a due date." };
  if (fields.due < today) return { error: "The due date can’t be in the past." };
  return { input: { matterId: fields.matter, description, amountCents, currency, dueOn: fields.due } };
}

/** Stripe's refund reasons (https://docs.stripe.com/api/refunds/create#create_refund-reason), "" for none. */
export const REFUND_REASONS: { value: string; label: string }[] = [
  { value: "requested_by_customer", label: "Requested by the client" },
  { value: "duplicate", label: "Duplicate payment" },
  { value: "fraudulent", label: "Fraudulent payment" },
  { value: "", label: "No reason given" },
];

/** Stripe refund failure reasons, in a few words. */
const REFUND_FAILURE: Record<string, string> = {
  lost_or_stolen_card: "card lost or stolen",
  expired_or_canceled_card: "card closed",
  charge_for_pending_refund_disputed: "payment disputed",
  insufficient_funds: "not enough balance",
  declined: "declined",
  merchant_request: "canceled by the firm",
};

/** A refund's badge (`invoice_refund_status`). Only verified Stripe events move it past pending. */
export function refundState(status: string, failureReason: string | null = null): State {
  switch (status) {
    case "pending":
      return { tone: "rev", label: "Processing" };
    case "requires_action":
      return { tone: "chg", label: "Needs action in Stripe" };
    case "succeeded":
      return { tone: "ok", label: "Refunded" };
    case "failed":
      return failureReason ? { tone: "bad", label: "Failed", detail: REFUND_FAILURE[failureReason] ?? failureReason.replaceAll("_", " ") } : { tone: "bad", label: "Failed" };
    case "canceled":
      return { tone: "gr", label: "Canceled" };
    default:
      return { tone: "gr", label: status };
  }
}

/** A dispute's badge (Stripe's `dispute.status`). Inquiries are the `warning_` states. */
export function disputeState(status: string): State {
  switch (status) {
    case "needs_response":
      return { tone: "chg", label: "Evidence needed" };
    case "under_review":
      return { tone: "rev", label: "Under review" };
    case "warning_needs_response":
      return { tone: "chg", label: "Inquiry", detail: "response needed" };
    case "warning_under_review":
      return { tone: "rev", label: "Inquiry", detail: "under review" };
    case "warning_closed":
      return { tone: "gr", label: "Inquiry closed" };
    case "won":
      return { tone: "ok", label: "Won" };
    case "lost":
      return { tone: "bad", label: "Lost" };
    case "prevented":
      return { tone: "gr", label: "Prevented" };
    default:
      return { tone: "gr", label: status };
  }
}

/** True while the firm can still answer the dispute (before its evidence deadline). */
export function disputeOpen(status: string): boolean {
  return status === "needs_response" || status === "warning_needs_response" || status === "under_review" || status === "warning_under_review";
}

/** "fraudulent" → "Fraudulent", "product_not_received" → "Product not received". */
export function disputeReason(reason: string | null | undefined): string {
  const text = (reason ?? "").replaceAll("_", " ").trim();
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "No reason given";
}

export type RefundFields = { payment: string; amount: string; reason: string };

/**
 * Checks the Refund dialog before it is sent: a payment, an amount above zero and no more than
 * `maxCents` (the refundable remainder the page was given), and one of Stripe's reasons.
 * The database checks everything again, against the payment itself.
 */
export function readRefund(fields: RefundFields, currency: string, maxCents: number | null):
  | { input: { paymentId: string; amountCents: number; reason: string | null } }
  | { error: string } {
  if (!UUID.test(fields.payment)) return { error: "Choose the payment to refund." };
  const amountCents = parseAmount(fields.amount, currency);
  if (amountCents === null) return { error: "Enter the amount to refund, like 130.00." };
  if (maxCents !== null && amountCents > maxCents) return { error: "That’s more than is left to refund on this payment." };
  if (!REFUND_REASONS.some((reason) => reason.value === fields.reason)) return { error: "Choose a reason." };
  return { input: { paymentId: fields.payment, amountCents, reason: fields.reason || null } };
}

/** User-facing copy for a refused refund. Never passes a database or Stripe message through. */
export function refundError(message: string): string {
  if (/billing access denied/i.test(message)) return "Only the firm owner or the matter’s finance user can refund this payment.";
  if (/exceeds the amount received/i.test(message)) return "That’s more than is left to refund on this payment.";
  if (/only a received card payment/i.test(message)) return "Only a card payment Stripe has received can be refunded.";
  if (/does not match the firm/i.test(message)) return "This payment went to a different Stripe account, so it can’t be refunded here.";
  if (/currency/i.test(message)) return "A refund is in the payment’s currency.";
  if (/amount must be positive/i.test(message)) return "Enter an amount above zero.";
  if (/reason/i.test(message)) return "Choose a reason.";
  if (/test-mode refunds/i.test(message)) return "Only Stripe test-mode refunds can be recorded.";
  if (/idempotency key|refund id is invalid|another payment/i.test(message)) return "The refund wasn’t recorded. Try again.";
  return financeError(message);
}

/** User-facing copy for a refused invoice or Stripe step. Never passes a database message through. */
export function financeError(message: string): string {
  if (/sample mode/i.test(message)) {
    return "This firm is in sample mode, so only sample matters take invoices. Turn sample mode off to invoice a real client.";
  }
  if (/billing access denied/i.test(message)) return "Only the firm owner or the matter’s finance user can invoice it.";
  if (/only CAD/i.test(message)) return "Invoices are in CAD for now.";
  if (/due date/i.test(message)) return "The due date can’t be in the past.";
  if (/amount must be positive/i.test(message)) return "Enter an amount above zero.";
  if (/description is required/i.test(message)) return "Describe the delivered work or incurred cost.";
  if (/already has a Stripe account/i.test(message)) return "This firm already has a Stripe account.";
  if (/test-mode/i.test(message)) return "Only a Stripe test-mode account can be connected.";
  return safeAccessError(message);
}

/** The step-up page, then back to this page with the dialog reopened. */
export function financeStepUpLocation(pathname: string, search: string, dialog: string | null): string {
  const params = new URLSearchParams(search);
  if (dialog) params.set("dlg", dialog);
  else params.delete("dlg");
  const query = params.toString();
  return `/mfa?step=6&next=${encodeURIComponent(`${pathname}${query ? `?${query}` : ""}`)}`;
}

const STEP_UP = new Set([safeAccessError("step-up is required"), safeAccessError("aal2")]);

export function financeNeedsStepUp(error: string | null | undefined): boolean {
  return Boolean(error && STEP_UP.has(error));
}
