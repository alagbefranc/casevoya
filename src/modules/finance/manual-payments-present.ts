import { safeAccessError } from "@/lib/auth/step-up";
import { CLIENT_FUND_METHODS, methodShort } from "@/modules/finance/client-funds-present";
import { parseAmount } from "@/modules/finance/money";

/**
 * Manual payments (FIN-09) and the reconciliation workspace (FIN-12): wording, input checks and
 * state badges. Nothing here decides access; the database does.
 */

/** `?dlg=manual` reopens the manual payment dialogs after a step-up; `?dlg=accounts` the bank account dialogs. */
export const MANUAL_DIALOG = "manual";
export const ACCOUNTS_DIALOG = "accounts";

/** The methods a manual payment takes: the client-fund methods, worded for the payment dialogs. */
export const MANUAL_METHODS: { value: string; label: string }[] = CLIENT_FUND_METHODS.map((method) =>
  method.value === "bank_transfer" ? { value: method.value, label: "Wire or bank transfer" } : { value: method.value, label: method.label },
);

export function manualMethodLabel(method: string | null | undefined): string {
  return method === "bank_transfer" ? "wire or bank transfer" : methodShort(method);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type ManualPaymentFields = {
  invoice: string;
  amount: string;
  method: string;
  reference: string;
  received: string;
  account: string;
  note: string;
  reviewer: string;
};

export type ManualPaymentInput = {
  invoiceId: string;
  amountCents: number;
  method: string;
  reference: string;
  receivedOn: string;
  accountId: string;
  note: string | null;
  reviewerId: string;
};

/**
 * Checks the Record a manual payment dialog. `hasFile`: an evidence file was chosen (the note may
 * then be empty). `maxCents`: what is still due less other pending payments, when the page knows it.
 */
export function readManualPayment(fields: ManualPaymentFields, today: string, hasFile: boolean, maxCents: number | null): { input: ManualPaymentInput } | { error: string } {
  if (!UUID.test(fields.invoice)) return { error: "Choose the invoice." };
  const amountCents = parseAmount(fields.amount, "CAD");
  if (amountCents === null) return { error: "Enter the amount received, like 100.00." };
  if (maxCents !== null && amountCents > maxCents) return { error: "That’s more than is due on the invoice, counting payments waiting for verification." };
  if (!MANUAL_METHODS.some((method) => method.value === fields.method)) return { error: "Choose how it was paid." };
  const reference = fields.reference.trim();
  if (!reference) return { error: "Enter the external reference: the e-Transfer reference, cheque number or wire confirmation." };
  if (reference.length > 80) return { error: "Keep the reference under 80 characters." };
  if (!DAY.test(fields.received)) return { error: "Choose the day it was received." };
  if (today && fields.received > today) return { error: "The received date can’t be in the future." };
  if (!UUID.test(fields.account)) return { error: "Choose the firm account it went to." };
  const note = fields.note.trim();
  if (note.length > 500) return { error: "Keep the evidence note under 500 characters." };
  if (!note && !hasFile) return { error: "Add the evidence: upload the statement line or screenshot, or describe it." };
  if (!UUID.test(fields.reviewer)) return { error: "Choose who reviews it." };
  return { input: { invoiceId: fields.invoice, amountCents, method: fields.method, reference, receivedOn: fields.received, accountId: fields.account, note: note || null, reviewerId: fields.reviewer } };
}

export type AdvanceFields = { party: string; amount: string; method: string; reference: string; received: string; account: string; evidence: string; reviewer: string };

/** The Client funds tab's Record a bank payment, with the reference, evidence and reviewer FIN-09 asks for. */
export function readAdvance(
  fields: AdvanceFields,
  today: string,
  hasFile: boolean,
):
  | { input: { matterId: string; personId: string; accountId: string; amountCents: number; method: string; reference: string; receivedOn: string; note: string | null; reviewerId: string } }
  | { error: string } {
  const [matterId = "", personId = ""] = fields.party.split(":");
  if (!UUID.test(matterId) || !UUID.test(personId)) return { error: "Choose the client and matter." };
  const amountCents = parseAmount(fields.amount, "CAD");
  if (amountCents === null) return { error: "Enter the amount received, like 1808.00." };
  if (!CLIENT_FUND_METHODS.some((method) => method.value === fields.method)) return { error: "Choose how it was paid." };
  const reference = fields.reference.trim();
  if (!reference) return { error: "Enter the external reference: the e-Transfer reference, cheque number or wire confirmation." };
  if (reference.length > 80) return { error: "Keep the reference under 80 characters." };
  if (!DAY.test(fields.received)) return { error: "Choose the day it was received." };
  if (today && fields.received > today) return { error: "The received date can’t be in the future." };
  if (!UUID.test(fields.account)) return { error: "Choose the client account it went to." };
  const note = fields.evidence.trim();
  if (note.length > 500) return { error: "Keep the evidence note under 500 characters." };
  if (!note && !hasFile) return { error: "Add the evidence: upload the statement line or screenshot, or describe it." };
  if (!UUID.test(fields.reviewer)) return { error: "Choose who reviews it." };
  return { input: { matterId, personId, accountId: fields.account, amountCents, method: fields.method, reference, receivedOn: fields.received, note: note || null, reviewerId: fields.reviewer } };
}

export type ReverseFields = { outcome: string; reason: string };

export function readReverse(fields: ReverseFields, wasVerified: boolean): { input: { outcome: "reversed" | "failed"; reason: string } } | { error: string } {
  if (fields.outcome !== "reversed" && fields.outcome !== "failed") return { error: "Choose reversed or failed." };
  if (fields.outcome === "reversed" && !wasVerified) return { error: "Only a verified payment can be reversed. Mark a pending one failed." };
  const reason = fields.reason.trim();
  if (reason.length < 3) return { error: "Say what the bank reported." };
  if (reason.length > 500) return { error: "Keep the reason under 500 characters." };
  return { input: { outcome: fields.outcome, reason } };
}

export type ReconItemFields = { kind: string; description: string; reference: string; date: string; amount: string };

export function readReconItem(fields: ReconItemFields, statementDate: string | null):
  | { input: { kind: "deposit_in_transit" | "outstanding_cheque"; description: string; reference: string | null; itemDate: string; amountCents: number } }
  | { error: string } {
  if (fields.kind !== "deposit_in_transit" && fields.kind !== "outstanding_cheque") return { error: "Choose a deposit in transit or an outstanding cheque." };
  const description = fields.description.trim();
  if (description.length < 3) return { error: "Describe the item, like “Cheque 104 to the client”." };
  if (description.length > 200) return { error: "Keep the description under 200 characters." };
  const reference = fields.reference.trim();
  if (reference.length > 80) return { error: "Keep the reference under 80 characters." };
  if (!DAY.test(fields.date)) return { error: "Choose the item’s date." };
  if (statementDate && fields.date > statementDate) return { error: "An outstanding item is dated on or before the statement date." };
  const amountCents = parseAmount(fields.amount, "CAD");
  if (amountCents === null) return { error: "Enter the amount, like 400.00." };
  return { input: { kind: fields.kind, description, reference: reference || null, itemDate: fields.date, amountCents } };
}

export type ManualState = { tone: "ok" | "rev" | "chg" | "gr" | "bad"; label: string; detail?: string };

/** A manual payment's badge. */
export function manualPaymentState(status: string, selfVerified = false): ManualState {
  switch (status) {
    case "pending_verification":
      return { tone: "rev", label: "Pending verification" };
    case "verified":
      return selfVerified ? { tone: "ok", label: "Verified", detail: "own entry" } : { tone: "ok", label: "Verified" };
    case "rejected":
      return { tone: "gr", label: "Rejected" };
    case "reversed":
      return { tone: "bad", label: "Reversed" };
    case "failed":
      return { tone: "bad", label: "Failed" };
    default:
      return { tone: "gr", label: status };
  }
}

/** The amount of an invoice's manual payments still pending verification. */
export function pendingManualCents(rows: readonly { status: string; amount_cents: number }[]): number {
  return rows.filter((row) => row.status === "pending_verification").reduce((sum, row) => sum + Number(row.amount_cents), 0);
}

/** Reviewer options for one matter: the firm owners, and finance users assigned to it. `except` (the viewer) last, when anyone else is eligible. */
export function reviewersFor(
  rows: readonly { user_id: string; display_name: string; role: string; matter_ids: string[] | null }[],
  matterId: string,
  viewer: string,
): { value: string; label: string }[] {
  const eligible = rows.filter((row) => row.role === "firm_owner" || (row.matter_ids ?? []).includes(matterId));
  const others = eligible.filter((row) => row.user_id !== viewer);
  const list = others.length ? others : eligible;
  return list.map((row) => ({ value: row.user_id, label: `${row.display_name}${row.role === "firm_owner" ? " (firm owner)" : " (finance)"}${row.user_id === viewer ? " (you)" : ""}` }));
}

/** User-facing copy for a refused manual payment or reconciliation item. Never passes a database message through. */
export function manualPaymentError(message: string): string {
  if (/only the named reviewer/i.test(message)) return "Only the reviewer named on this payment, or the firm owner, verifies it.";
  if (/recorded a payment cannot verify/i.test(message)) return "You recorded this payment, so someone else verifies it. The firm owner may verify their own entry.";
  if (/verifying your own payment needs a step-up/i.test(message)) return safeAccessError("step-up is required");
  if (/reviewer other than yourself/i.test(message)) return "Choose someone other than yourself to review it.";
  if (/choose a reviewer/i.test(message)) return "Choose a reviewer: the firm owner or a finance user on this matter.";
  if (/evidence is required/i.test(message)) return "Add the evidence: upload the statement line or screenshot, or describe it.";
  if (/cleared upload on this matter/i.test(message)) return "The evidence file isn’t cleared yet. Try again shortly.";
  if (/external reference is required/i.test(message)) return "Enter the external reference.";
  if (/exceeds the amount due/i.test(message)) return "That’s more than is due on the invoice, counting payments waiting for verification.";
  if (/only an issued invoice/i.test(message)) return "Only an issued invoice with an amount due takes a payment. Reject it or mark it failed instead.";
  if (/card payment on this invoice is processing/i.test(message)) return "A card payment on this invoice is processing. Wait until Stripe confirms or fails it.";
  if (/operating account/i.test(message)) return "Choose the firm’s operating account. The firm owner adds it in Settings.";
  if (/only a payment pending verification/i.test(message)) return "This payment was already verified, rejected or marked failed.";
  if (/only a verified payment can be reversed/i.test(message)) return "Only a verified payment can be reversed. Mark a pending one failed.";
  if (/only a pending or verified payment/i.test(message)) return "This payment was already rejected, reversed or marked failed.";
  if (/refunds on this invoice exceed/i.test(message)) return "Card refunds on this invoice are more than would stay paid. Check the refunds first.";
  if (/only a reconciliation waiting for review takes/i.test(message) || /items are locked/i.test(message)) return "This reconciliation is signed or discarded, so its items are locked.";
  if (/on or before the statement date/i.test(message)) return "An outstanding item is dated on or before the statement date.";
  if (/deposit in transit or an outstanding cheque/i.test(message)) return "Choose a deposit in transit or an outstanding cheque.";
  if (/already removed/i.test(message)) return "That item was already removed.";
  if (/describe the item/i.test(message)) return "Describe the item.";
  if (/signed reconciliation period/i.test(message)) return "That date is in a month that’s already reconciled. Use a later date.";
  if (/reconciliation access denied/i.test(message)) return "Only the firm owner or a finance user reconciles the client account.";
  if (/firm owner step-up/i.test(message)) return safeAccessError("step-up is required");
  if (/last four digits/i.test(message)) return "Enter only the last four digits of the account number.";
  if (/sample mode/i.test(message)) return "This firm is in sample mode, so only sample invoices and matters take payments.";
  if (/billing access denied/i.test(message)) return "Only the firm owner or the matter’s finance user can do this.";
  if (/future/i.test(message)) return "The date can’t be in the future.";
  if (/too long before the invoice/i.test(message)) return "That received date is more than a year before the invoice.";
  if (/reason is required/i.test(message)) return "Give a short reason.";
  if (/choose reversed or failed/i.test(message)) return "Choose reversed or failed.";
  if (/method is invalid/i.test(message)) return "Choose how it was paid.";
  if (/amount must be positive/i.test(message)) return "Enter an amount above zero.";
  if (/client account/i.test(message)) return "Choose the firm’s client account.";
  if (/idempotency key|too long/i.test(message)) return "Check the form and try again.";
  return safeAccessError(message);
}
