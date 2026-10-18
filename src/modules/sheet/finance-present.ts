import { safeAccessError } from "@/lib/auth/step-up";
import { isInvoiceCurrency, normalizeCurrency, parseAmount } from "@/modules/finance/money";

/** Finance page and invoice wording that does not depend on the database. */

export const INVOICE_DIALOG = "invoice";

export type InvoiceTone = "blue" | "ok" | "unv" | "chg" | "bad" | "rev" | "gr";

/** The state badge and the filter chip token for an invoice. Overdue is derived, never stored. */
export function invoiceState(status: string, dueOn: string, today: string, processing = false): { tone: InvoiceTone; label: string; flag: string } {
  const open = status === "issued" || status === "partially_paid";
  if (open && processing) return { tone: "rev", label: "Payment processing", flag: status === "issued" ? "issued" : "partial" };
  if (open && dueOn < today) return { tone: "bad", label: "Overdue", flag: "overdue" };
  switch (status) {
    case "draft":
      return { tone: "gr", label: "Draft", flag: "draft" };
    case "issued":
      return { tone: "blue", label: "Issued", flag: "issued" };
    case "partially_paid":
      return { tone: "chg", label: "Partially paid", flag: "partial" };
    case "paid":
      return { tone: "ok", label: "Paid", flag: "paid" };
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
 * (the client opened the card form, nothing was charged) is not listed on the tab.
 */
export function paymentState(status: string): { tone: InvoiceTone; label: string } {
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
