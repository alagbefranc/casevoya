import { safeAccessError } from "@/lib/auth/step-up";
import { formatMoney, parseAmount } from "@/modules/finance/money";

/**
 * Corrections to issued invoices (voids and credit notes, FIN-06/07) and client-account
 * reconciliations (FIN-12): wording, input checks and the invoice arithmetic the pages show.
 * Nothing here decides access or limits; the database does, and these checks only spare a round trip.
 */

/** `?dlg=` values for the step-up round trip. */
export const CREDIT_NOTE_DIALOG = "credit";
export const RECON_DIALOG = "recon";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isId(value: string): boolean {
  return UUID.test(value);
}

export type InvoiceMoney = {
  status: string;
  amountCents: number;
  paidCents: number;
  creditedCents: number;
  refundedCents: number;
};

/** What the client still owes: the amount less payments and credits (never below zero). Closed invoices owe nothing. */
export function amountDue(invoice: InvoiceMoney): number {
  if (invoice.status !== "issued" && invoice.status !== "partially_paid") return 0;
  return Math.max(0, invoice.amountCents - invoice.paidCents - invoice.creditedCents);
}

/**
 * Money the firm holds beyond what the invoice now asks for (net of refunds), to be refunded
 * separately: a credit note on a paid invoice, or a payment that arrived after a void.
 */
export function creditBalance(invoice: InvoiceMoney): number {
  const kept = invoice.paidCents - invoice.refundedCents;
  if (invoice.status === "voided") return Math.max(0, kept);
  return Math.max(0, kept + invoice.creditedCents - invoice.amountCents);
}

/**
 * What can still be credited: the amount less issued credits, drafts waiting for review, and what
 * was already refunded (that money went back to the client; crediting it too would return it twice).
 */
export function creditable(invoice: Pick<InvoiceMoney, "amountCents" | "creditedCents"> & Partial<Pick<InvoiceMoney, "refundedCents">>, draftsCents: number): number {
  return Math.max(0, invoice.amountCents - invoice.creditedCents - (invoice.refundedCents ?? 0) - draftsCents);
}

/** The signed reconciliations' heading: "Earlier months", unless one is for the firm's current month. */
export function reconHistoryTitle(statementDates: readonly string[], today: string): string {
  const month = today.slice(0, 7);
  return statementDates.some((date) => date.slice(0, 7) >= month) ? "Signed reconciliations" : "Earlier months";
}

/** An invoice can be credited while it is issued (paid or not); never a draft, voided or fully credited one. */
export function canCredit(status: string): boolean {
  return status === "issued" || status === "partially_paid" || status === "paid" || status === "refunded";
}

/**
 * Whether the void button is offered (the database checks again): issued, nothing paid or credited,
 * no card payment received or processing, no client-account transfer, no receipt, no credit note.
 */
export function canVoid(invoice: InvoiceMoney, blockers: { payments: number; transfers: number; receipts: number; creditNotes: number }): boolean {
  return (
    invoice.status === "issued" &&
    invoice.paidCents === 0 &&
    invoice.creditedCents === 0 &&
    blockers.payments === 0 &&
    blockers.transfers === 0 &&
    blockers.receipts === 0 &&
    blockers.creditNotes === 0
  );
}

export type CreditNoteFields = { invoice: string; amount: string; reason: string };

export function readCreditNote(fields: CreditNoteFields, maxCents: number | null): { input: { invoiceId: string; amountCents: number; reason: string } } | { error: string } {
  if (!UUID.test(fields.invoice)) return { error: "Choose the invoice." };
  const amountCents = parseAmount(fields.amount, "CAD");
  if (amountCents === null) return { error: "Enter the amount to credit, like 113.00." };
  if (maxCents !== null && amountCents > maxCents) return { error: `That’s more than can still be credited (${formatMoney(maxCents, "CAD")}).` };
  const reason = fields.reason.trim();
  if (reason.length < 3) return { error: "Give the reason for the credit." };
  if (reason.length > 500) return { error: "Keep the reason under 500 characters." };
  return { input: { invoiceId: fields.invoice, amountCents, reason } };
}

export function readReasonText(value: string, max = 500): { reason: string } | { error: string } {
  const reason = value.trim();
  if (reason.length < 3) return { error: "Give a short reason." };
  if (reason.length > max) return { error: `Keep it under ${max} characters.` };
  return { reason };
}

/** A typed bank balance: "1,234.56", "-12.00" (an overdrawn account), "0". Minor units, or null. */
export function parseBalance(input: string): number | null {
  let text = input.trim().replace(/^CAD\s*/i, "");
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  if (/^[-−]/.test(text)) {
    negative = !negative;
    text = text.slice(1).trim();
  }
  const cleaned = text.replace(/^(CA)?\$|\s|,/gi, "");
  if (/^0+(\.0{1,2})?$/.test(cleaned)) return 0;
  const cents = parseAmount(cleaned, "CAD");
  if (cents === null) return null;
  return negative ? -cents : cents;
}

export type ReconciliationFields = { account: string; date: string; balance: string; note: string };

export function readReconciliation(
  fields: ReconciliationFields,
  today: string,
  after: string | null,
): { input: { accountId: string; statementDate: string; balanceCents: number; note: string | null } } | { error: string } {
  if (!UUID.test(fields.account)) return { error: "Choose the client account." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date)) return { error: "Enter the statement date." };
  if (today && fields.date > today) return { error: "The statement date can’t be in the future." };
  if (after && fields.date <= after) return { error: "Use a statement dated after the last signed reconciliation." };
  const balanceCents = parseBalance(fields.balance);
  if (balanceCents === null) return { error: "Enter the closing balance on the statement, like 3,308.00." };
  const note = fields.note.trim();
  if (note.length > 2000) return { error: "Keep the note under 2,000 characters." };
  return { input: { accountId: fields.account, statementDate: fields.date, balanceCents, note: note || null } };
}

export type SignFields = { outcome: string; notes: string };

export function readSign(fields: SignFields, differenceCents: number | null): { input: { outcome: "reconciled" | "exceptions"; notes: string | null } } | { error: string } {
  const notes = fields.notes.trim();
  if (notes.length > 2000) return { error: "Keep the notes under 2,000 characters." };
  if (fields.outcome === "reconciled") {
    if (differenceCents !== null && differenceCents !== 0) return { error: "The difference must be zero to sign as reconciled. Record exceptions instead." };
    return { input: { outcome: "reconciled", notes: notes || null } };
  }
  if (fields.outcome === "exceptions") {
    if (notes.length < 3) return { error: "Explain the exceptions." };
    return { input: { outcome: "exceptions", notes } };
  }
  return { error: "Choose how to sign it." };
}

/** User-facing copy for a refused correction or reconciliation. Never passes a database message through. */
export function correctionError(message: string): string {
  if (/cannot issue their own credit note/i.test(message)) return "You drafted this credit note, so someone else issues it. The firm owner may issue their own draft.";
  if (/issuing your own credit note needs a step-up/i.test(message)) return safeAccessError("step-up is required");
  if (/preparer cannot sign/i.test(message)) return "You prepared this reconciliation, so someone else signs it. The firm owner may sign their own.";
  if (/signing your own reconciliation needs a step-up/i.test(message)) return safeAccessError("step-up is required");
  if (/exceeds the amount not already credited/i.test(message)) return "That’s more than can still be credited on this invoice, counting drafts waiting for review.";
  if (/only an issued invoice can be credited/i.test(message)) return "Only an issued invoice that isn’t voided or fully credited can be credited.";
  if (/only a draft credit note/i.test(message)) return "This credit note was already issued or declined.";
  if (/card payment on this invoice is processing/i.test(message)) return "A card payment on this invoice is processing. Wait until Stripe confirms or fails it.";
  if (/nothing paid or credited/i.test(message)) return "Only an issued invoice with nothing paid or credited can be voided. Use a credit note instead.";
  if (/received or is processing/i.test(message)) return "A card payment on this invoice was received or is processing, so it can’t be voided. Use a credit note.";
  if (/client-account transfer is allocated/i.test(message)) return "A transfer from the client account is allocated to this invoice, so it can’t be voided.";
  if (/receipt was issued/i.test(message)) return "A payment receipt was issued for this invoice, so it can’t be voided.";
  if (/has a credit note/i.test(message)) return "This invoice has a credit note, so it can’t be voided.";
  if (/waiting for review/i.test(message) && /prepare|account/i.test(message)) return "A reconciliation for this account is already waiting for review. Sign or discard it first.";
  if (/only a reconciliation waiting for review/i.test(message)) return "This reconciliation was already signed or discarded.";
  if (/after the last signed reconciliation/i.test(message)) return "Use a statement dated after the last signed reconciliation.";
  if (/ledger changed since/i.test(message)) return "The ledger changed since this was prepared. Discard it and prepare it again.";
  if (/difference must be zero/i.test(message)) return "The difference must be zero to sign as reconciled. Record exceptions instead.";
  if (/exceptions need notes/i.test(message)) return "Explain the exceptions.";
  if (/reconciliation access denied/i.test(message)) return "Only the firm owner or a finance user reconciles the client account.";
  if (/credit note access denied/i.test(message)) return "That credit note isn’t available to you.";
  if (/sample mode/i.test(message)) return "This firm is in sample mode, so only sample invoices can be corrected.";
  if (/billing access denied/i.test(message)) return "Only the firm owner or the matter’s finance user can do this.";
  if (/future/i.test(message)) return "The date can’t be in the future.";
  if (/statement balance/i.test(message)) return "Enter the closing balance on the statement.";
  if (/reason is required/i.test(message)) return "Give a short reason.";
  if (/amount must be positive/i.test(message)) return "Enter an amount above zero.";
  if (/idempotency key|too long/i.test(message)) return "Check the form and try again.";
  return safeAccessError(message);
}

/** The state badge for a credit note. */
export function creditNoteState(status: string, ownerSelf = false): { tone: "ok" | "rev" | "gr"; label: string; detail?: string } {
  if (status === "issued") return ownerSelf ? { tone: "ok", label: "Issued", detail: "by owner (own draft)" } : { tone: "ok", label: "Issued" };
  if (status === "draft") return { tone: "rev", label: "Draft", detail: "waiting for review" };
  return { tone: "gr", label: "Declined" };
}

/** The state badge for a reconciliation. */
export function reconciliationState(status: string, ownerSelf = false): { tone: "ok" | "rev" | "chg" | "gr"; label: string; detail?: string } {
  if (status === "reconciled") return ownerSelf ? { tone: "ok", label: "Reconciled", detail: "signed by owner (own preparation)" } : { tone: "ok", label: "Reconciled" };
  if (status === "exceptions") return { tone: "chg", label: "Signed with exceptions" };
  if (status === "pending_review") return { tone: "rev", label: "Waiting for review" };
  return { tone: "gr", label: "Discarded" };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "October 2026" from "2026-10-16". */
export function monthLabel(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return year && month && month <= 12 ? `${MONTHS[month - 1]} ${year}` : date;
}

/** "1,808.00", "−12.00" for a signed amount (U+2212 minus, as the Designer writes negatives). */
export function signedAmount(cents: number, format: (minor: number) => string): string {
  return cents < 0 ? `−${format(-cents)}` : format(cents);
}
