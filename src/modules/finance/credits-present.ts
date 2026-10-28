import { safeAccessError } from "@/lib/auth/step-up";
import { formatMoney, parseAmount } from "@/modules/finance/money";

/**
 * Client credits (overpayments) and dispute evidence (FIN-13): the arithmetic and wording the
 * Finance page shows, and the checks the dialogs run before sending. The database decides access
 * and limits again (app.client_credit_available_cents, app.apply_client_credit,
 * app.record_client_credit_bank_refund, app.dispute_evidence_context); these only spare a round trip.
 */

/** `?dlg=` values for the step-up round trip. */
export const CREDIT_DIALOG = "client-credit";
export const EVIDENCE_DIALOG = "evidence";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CreditInvoice = { status: string; amountCents: number; paidCents: number; refundedCents: number; creditedCents: number };

/** What an invoice holds beyond what it asks for (app.invoice_overpaid_cents). */
export function overpaidCents(invoice: CreditInvoice): number {
  if (invoice.status === "draft") return 0;
  if (invoice.status === "voided") return Math.max(0, invoice.paidCents - invoice.refundedCents);
  return Math.max(0, invoice.paidCents - invoice.refundedCents + invoice.creditedCents - invoice.amountCents);
}

/** What a credit can still be refunded or applied: the overpayment less card refunds pending at Stripe. */
export function creditAvailableCents(invoice: CreditInvoice, pendingCardRefundsCents: number): number {
  return Math.max(0, overpaidCents(invoice) - Math.max(0, pendingCardRefundsCents));
}

export type CreditAllocation =
  | { kind: "invoice"; amountCents: number; currency: string; invoiceNumber: string }
  | { kind: "card_refund"; amountCents: number; currency: string; refundNumber: string; refundStatus: string }
  | { kind: "bank_refund"; amountCents: number; currency: string; method: string; reference: string };

const METHOD: Record<string, string> = { e_transfer: "e-Transfer", cheque: "cheque", wire: "wire" };

const REFUND_STATUS: Record<string, string> = {
  pending: "processing",
  requires_action: "needs action in Stripe",
  succeeded: "refunded",
  failed: "failed",
  canceled: "canceled",
};

/** "Applied to INV-0003, CAD 50.00"; "Card refund RF-0004, CAD 30.00, processing"; "Bank refund by e-Transfer ET-1, CAD 20.00". */
export function allocationLine(allocation: CreditAllocation): string {
  const money = formatMoney(allocation.amountCents, allocation.currency);
  if (allocation.kind === "invoice") return `Applied to ${allocation.invoiceNumber}, ${money}`;
  if (allocation.kind === "card_refund") return `Card refund ${allocation.refundNumber}, ${money}, ${REFUND_STATUS[allocation.refundStatus] ?? allocation.refundStatus}`;
  return `Bank refund by ${METHOD[allocation.method] ?? allocation.method} ${allocation.reference}, ${money}`;
}

export function creditState(status: string, availableCents: number, pendingCardCents: number): { tone: "chg" | "ok" | "rev" | "gr"; label: string; detail?: string } {
  if (availableCents > 0) return { tone: "chg", label: "To refund or apply" };
  if (pendingCardCents > 0) return { tone: "rev", label: "Refund processing" };
  return status === "settled" ? { tone: "ok", label: "Settled" } : { tone: "gr", label: "Nothing left" };
}

export type CreditMode = "apply" | "card" | "bank";

export type CreditFields = {
  credit: string;
  mode: string;
  amount: string;
  target: string;
  method: string;
  reference: string;
  refundedOn: string;
};

export type CreditInput =
  | { mode: "apply"; creditId: string; amountCents: number; targetInvoiceId: string }
  | { mode: "card"; creditId: string; amountCents: number }
  | { mode: "bank"; creditId: string; amountCents: number; method: "e_transfer" | "cheque" | "wire"; reference: string; refundedOn: string };

/** Checks the credit dialog before it is sent. `maxCents` is what the page said was left. */
export function readCredit(fields: CreditFields, maxCents: number | null, today: string): { input: CreditInput } | { error: string } {
  if (!UUID.test(fields.credit)) return { error: "Choose the credit." };
  const amountCents = parseAmount(fields.amount, "CAD");
  if (amountCents === null) return { error: "Enter the amount, like 50.00." };
  if (maxCents !== null && amountCents > maxCents) return { error: "That’s more than is left on this credit." };
  if (fields.mode === "apply") {
    if (!UUID.test(fields.target)) return { error: "Choose the invoice to apply it to." };
    return { input: { mode: "apply", creditId: fields.credit, amountCents, targetInvoiceId: fields.target } };
  }
  if (fields.mode === "card") return { input: { mode: "card", creditId: fields.credit, amountCents } };
  if (fields.mode === "bank") {
    if (fields.method !== "e_transfer" && fields.method !== "cheque" && fields.method !== "wire") return { error: "Choose how the money was returned." };
    const reference = fields.reference.trim();
    if (!reference || reference.length > 120) return { error: "Enter the bank reference." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.refundedOn)) return { error: "Enter the date the money was returned." };
    if (today && fields.refundedOn > today) return { error: "The refund date can’t be in the future." };
    return { input: { mode: "bank", creditId: fields.credit, amountCents, method: fields.method, reference, refundedOn: fields.refundedOn } };
  }
  return { error: "Choose what to do with the credit." };
}

/** A refused credit step, in the firm's words. Never passes a database message through. */
export function creditError(message: string): string {
  if (/billing access denied/i.test(message)) return "Only the firm owner or the matter’s finance user can move this credit.";
  if (/still pending at Stripe/i.test(message)) return "A card refund of this invoice is still pending at Stripe. Wait for Stripe to confirm or fail it before recording a bank refund, so the client isn’t refunded twice.";
  if (/same client/i.test(message)) return "A credit can only go to the same client’s invoices.";
  if (/more than the credit available/i.test(message)) return "That’s more than is left on this credit.";
  if (/more than that invoice still owes/i.test(message)) return "That’s more than the invoice still owes.";
  if (/not open/i.test(message)) return "That invoice isn’t open any more.";
  if (/another currency/i.test(message)) return "That invoice is in another currency.";
  if (/another invoice/i.test(message)) return "Choose a different invoice from the one holding the credit.";
  if (/future/i.test(message)) return "The refund date can’t be in the future.";
  if (/bank reference/i.test(message)) return "Enter the bank reference.";
  if (/how the money was returned/i.test(message)) return "Choose how the money was returned.";
  if (/amount must be positive/i.test(message)) return "Enter an amount above zero.";
  if (/idempotency key/i.test(message)) return "That wasn’t saved. Try again.";
  return safeAccessError(message);
}

/** Stripe's limit for dispute evidence files (https://docs.stripe.com/disputes/best-practices: 4.5 MB in total). */
export const EVIDENCE_MAX_BYTES = 4_718_592;

export type EvidenceType = "application/pdf" | "image/jpeg" | "image/png";

/** The file's real type from its first bytes: PDF, JPEG or PNG. Anything else is refused. */
export function evidenceType(bytes: Uint8Array): EvidenceType | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  return null;
}

/** A safe display name: no path, no control characters, at most 200 characters. */
export function evidenceName(raw: string | null | undefined, type: EvidenceType): string {
  const base = (raw ?? "").split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
  if (clean) return clean;
  return type === "application/pdf" ? "evidence.pdf" : type === "image/png" ? "evidence.png" : "evidence.jpg";
}

/** A refused evidence step, in the firm's words. */
export function evidenceError(message: string): string {
  if (/billing access denied/i.test(message)) return "Only the firm owner or the matter’s finance user can respond to this dispute.";
  if (/no longer takes evidence/i.test(message)) return "Stripe no longer takes evidence for this dispute.";
  if (/deadline has passed/i.test(message)) return "The evidence deadline has passed.";
  if (/does not match the firm/i.test(message)) return "This dispute is on a different Stripe account.";
  if (/closed/i.test(message)) return "This dispute is closed.";
  return safeAccessError(message);
}
