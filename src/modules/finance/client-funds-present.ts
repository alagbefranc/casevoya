import { safeAccessError } from "@/lib/auth/step-up";
import { formatAmount, parseAmount } from "@/modules/finance/money";

/**
 * Client funds (the firm's own client account, recorded by hand): wording, input checks and the
 * running balance of a client's sub-ledger. Nothing here decides access; the database does.
 */

export const FUNDS_DIALOG = "funds";

export const CLIENT_FUND_METHODS: { value: string; label: string; short: string }[] = [
  { value: "bank_transfer", label: "Bank transfer", short: "bank transfer" },
  { value: "interac_e_transfer", label: "Interac e-Transfer", short: "Interac e-Transfer" },
  { value: "cheque", label: "Cheque", short: "cheque" },
  { value: "cash", label: "Cash (receipt required)", short: "cash" },
];

export function methodShort(method: string | null | undefined): string {
  return CLIENT_FUND_METHODS.find((item) => item.value === method)?.short ?? "recorded by hand";
}

export type FundEntry = {
  id: string;
  number: string;
  kind: "deposit" | "transfer" | "refund" | "correction";
  status: "pending_verification" | "verified" | "rejected" | "pending_approval" | "approved" | "declined" | "recorded";
  direction: "in" | "out";
  amountCents: number;
  occurredOn: string;
  method: string | null;
  reference: string | null;
  evidence: string | null;
  note: string | null;
  /** "INV-0001" for a transfer. */
  invoiceNumber: string | null;
  /** "CF-0002" for a correction. */
  reversesNumber: string | null;
  recordedBy: string;
  verifiedBy: string | null;
  approvedBy: string | null;
  ownerSelfApproved: boolean;
};

/** What an entry does to the client's balance once it counts (0 while pending, rejected or declined). */
export function entryEffect(entry: Pick<FundEntry, "kind" | "status" | "direction" | "amountCents">): number {
  if (entry.kind === "deposit") return entry.status === "verified" ? entry.amountCents : 0;
  if (entry.kind === "transfer") return entry.status === "approved" ? -entry.amountCents : 0;
  return entry.direction === "in" ? entry.amountCents : -entry.amountCents;
}

export type LedgerTotals = { balanceCents: number; pendingInCents: number; pendingOutCents: number; availableCents: number };

export function ledgerTotals(entries: Pick<FundEntry, "kind" | "status" | "direction" | "amountCents">[]): LedgerTotals {
  let balance = 0;
  let pendingIn = 0;
  let pendingOut = 0;
  for (const entry of entries) {
    balance += entryEffect(entry);
    if (entry.kind === "deposit" && entry.status === "pending_verification") pendingIn += entry.amountCents;
    if (entry.kind === "transfer" && entry.status === "pending_approval") pendingOut += entry.amountCents;
  }
  return { balanceCents: balance, pendingInCents: pendingIn, pendingOutCents: pendingOut, availableCents: Math.max(0, balance - pendingOut) };
}

/** The Designer's ledger row: date, entry, evidence, in, out, balance (amounts without currency). */
export type LedgerLine = { key: string; date: string; entry: string[]; evidence: string[]; in: string; out: string; balance: string };

function shortText(text: string, max = 40): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * The sub-ledger's rows in the order they were recorded, with the running balance. A deposit
 * waiting for verification shows its amount in "In" and the balance as "… available" (it doesn't
 * count yet); a proposed transfer shows its amount in brackets in "Out" and leaves the balance.
 */
export function ledgerLines(entries: FundEntry[], day: (iso: string) => string, currency = "CAD"): LedgerLine[] {
  let balance = 0;
  const amount = (cents: number) => formatAmount(cents, currency);
  return entries.map((entry) => {
    balance += entryEffect(entry);
    const by = (name: string | null) => (name ? name.split(" ")[0] : null);
    let label: string[];
    let evidence: string[];
    let inText = "";
    let outText = "";
    let balanceText = amount(balance);
    let date = day(entry.occurredOn);
    switch (entry.kind) {
      case "deposit": {
        const reference = entry.reference ?? "No reference";
        if (entry.status === "pending_verification") {
          label = ["Advance deposit", `${methodShort(entry.method)}, recorded by hand`];
          evidence = [reference, entry.evidence ? shortText(entry.evidence, 24) : `by ${by(entry.recordedBy)}`];
          inText = amount(entry.amountCents);
          balanceText = `${amount(balance)} available`;
        } else if (entry.status === "rejected") {
          label = ["Advance deposit not matched", methodShort(entry.method)];
          evidence = [reference, "rejected"];
        } else {
          label = ["Advance deposit", methodShort(entry.method)];
          evidence = [reference, by(entry.verifiedBy) ?? "verified"];
          inText = amount(entry.amountCents);
        }
        break;
      }
      case "transfer": {
        const target = entry.invoiceNumber ?? "an invoice";
        const note = entry.note ? ` ${shortText(entry.note, 32)}` : "";
        if (entry.status === "pending_approval") {
          date = "—";
          label = [`Proposed earned-fee transfer → ${target}${note}`];
          evidence = ["Needs approval"];
          outText = `(${amount(entry.amountCents)})`;
        } else if (entry.status === "declined") {
          label = [`Declined earned-fee transfer → ${target}`];
          evidence = ["Funds stayed in the client account"];
        } else {
          label = [`Earned-fee transfer → ${target}${note}`];
          evidence = [entry.ownerSelfApproved ? "Approved by owner (own request)" : `Approved by ${entry.approvedBy ?? "a second person"}`];
          outText = amount(entry.amountCents);
        }
        break;
      }
      case "refund":
        label = ["Refund to client", methodShort(entry.method)];
        evidence = [entry.reference ?? "No reference", by(entry.recordedBy) ?? "recorded"];
        outText = amount(entry.amountCents);
        break;
      default:
        label = ["Correction", `reverses ${entry.reversesNumber ?? "an entry"}`];
        evidence = [entry.note ? shortText(entry.note, 32) : "Reversing entry"];
        if (entry.direction === "in") inText = amount(entry.amountCents);
        else outText = amount(entry.amountCents);
    }
    return { key: entry.id, date, entry: label, evidence, in: inText, out: outText, balance: balanceText };
  });
}

export type FundsBadge = { tone: "ok" | "rev" | "chg" | "gr"; label: string };

export function ledgerBadge(entries: FundEntry[]): FundsBadge {
  if (entries.some((entry) => entry.kind === "deposit" && entry.status === "pending_verification")) return { tone: "rev", label: "Pending verification" };
  if (entries.some((entry) => entry.kind === "transfer" && entry.status === "pending_approval")) return { tone: "chg", label: "Approval needed" };
  return ledgerTotals(entries).balanceCents > 0 ? { tone: "ok", label: "Verified" } : { tone: "gr", label: "No balance" };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type DepositFields = { party: string; amount: string; method: string; reference: string; received: string; account: string; evidence: string };

/** `party` is "<matter id>:<person id>", one option of the Client and matter select. */
export function readDeposit(fields: DepositFields, today: string):
  | { input: { matterId: string; personId: string; accountId: string; amountCents: number; method: string; reference: string | null; receivedOn: string; evidence: string | null } }
  | { error: string } {
  const [matterId = "", personId = ""] = fields.party.split(":");
  if (!UUID.test(matterId) || !UUID.test(personId)) return { error: "Choose the client and matter." };
  const amountCents = parseAmount(fields.amount, "CAD");
  if (amountCents === null) return { error: "Enter the amount received, like 1808.00." };
  if (!CLIENT_FUND_METHODS.some((method) => method.value === fields.method)) return { error: "Choose how it was paid." };
  const reference = fields.reference.trim();
  if (reference.length > 80) return { error: "Keep the reference under 80 characters." };
  if (!DAY.test(fields.received)) return { error: "Choose the day it was received." };
  if (fields.received > today) return { error: "The received date can’t be in the future." };
  if (!UUID.test(fields.account)) return { error: "Choose the client account it went to." };
  const evidence = fields.evidence.trim();
  if (evidence.length > 500) return { error: "Keep the evidence note under 500 characters." };
  return { input: { matterId, personId, accountId: fields.account, amountCents, method: fields.method, reference: reference || null, receivedOn: fields.received, evidence: evidence || null } };
}

export type TransferFields = { ledger: string; invoice: string; amount: string; note: string };

export function readTransfer(fields: TransferFields, maxCents: number | null):
  | { input: { ledgerId: string; invoiceId: string; amountCents: number; note: string | null } }
  | { error: string } {
  if (!UUID.test(fields.ledger)) return { error: "Choose the client ledger." };
  if (!UUID.test(fields.invoice)) return { error: "Choose the issued invoice it pays." };
  const amountCents = parseAmount(fields.amount, "CAD");
  if (amountCents === null) return { error: "Enter the amount, like 300.00." };
  if (maxCents !== null && amountCents > maxCents) return { error: "That’s more than the client has available or the invoice has due." };
  const note = fields.note.trim();
  if (note.length > 500) return { error: "Keep the note under 500 characters." };
  return { input: { ledgerId: fields.ledger, invoiceId: fields.invoice, amountCents, note: note || null } };
}

export type RefundToClientFields = { ledger: string; amount: string; method: string; reference: string; paid: string; reason: string };

export function readRefundToClient(fields: RefundToClientFields, today: string, maxCents: number | null):
  | { input: { ledgerId: string; amountCents: number; method: string; reference: string | null; paidOn: string; reason: string } }
  | { error: string } {
  if (!UUID.test(fields.ledger)) return { error: "Choose the client ledger." };
  const amountCents = parseAmount(fields.amount, "CAD");
  if (amountCents === null) return { error: "Enter the amount, like 500.00." };
  if (maxCents !== null && amountCents > maxCents) return { error: "That’s more than the client has available." };
  if (!CLIENT_FUND_METHODS.some((method) => method.value === fields.method)) return { error: "Choose how it was paid back." };
  const reference = fields.reference.trim();
  if (reference.length > 80) return { error: "Keep the reference under 80 characters." };
  if (!DAY.test(fields.paid)) return { error: "Choose the day it was paid back." };
  if (fields.paid > today) return { error: "The date can’t be in the future." };
  const reason = readReason(fields.reason);
  if ("error" in reason) return reason;
  return { input: { ledgerId: fields.ledger, amountCents, method: fields.method, reference: reference || null, paidOn: fields.paid, reason: reason.reason } };
}

export function readReason(value: string): { reason: string } | { error: string } {
  const reason = value.trim();
  if (reason.length < 3) return { error: "Give a short reason." };
  if (reason.length > 500) return { error: "Keep the reason under 500 characters." };
  return { reason };
}

export function readEntryId(value: string): { entryId: string } | { error: string } {
  return UUID.test(value) ? { entryId: value } : { error: "Choose the entry." };
}

export type AccountFields = { label: string; institution: string; last4: string };

export function readClientAccount(fields: AccountFields): { input: AccountFields } | { error: string } {
  const label = fields.label.trim();
  const institution = fields.institution.trim();
  const last4 = fields.last4.trim();
  if (!label || label.length > 80) return { error: "Name the account, like “Client account”." };
  if (!institution || institution.length > 120) return { error: "Enter the bank or credit union." };
  if (!/^\d{4}$/.test(last4)) return { error: "Enter only the last four digits of the account number." };
  return { input: { label, institution, last4 } };
}

/** User-facing copy for a refused client-funds action. Never passes a database message through. */
export function clientFundsError(message: string): string {
  if (/cannot approve their own transfer/i.test(message)) return "You asked for this transfer, so someone else approves it. The firm owner can approve any transfer.";
  if (/approving your own request needs a step-up/i.test(message)) return safeAccessError("step-up is required");
  if (/sample mode/i.test(message)) return "This firm is in sample mode, so only sample matters take client funds. Turn sample mode off to record a real client’s money.";
  if (/billing access denied/i.test(message)) return "Only the firm owner or the matter’s finance user can do this.";
  if (/firm owner step-up/i.test(message)) return "Only the firm owner adds a client account, after confirming with their authenticator.";
  if (/available balance|go negative|balance negative/i.test(message)) return "That’s more than the client has available. Pending transfers hold their amount until they’re approved or declined.";
  if (/amount due/i.test(message)) return "That’s more than is due on the invoice, counting transfers already waiting for approval.";
  if (/same matter/i.test(message)) return "A client’s money only pays an invoice on the same matter.";
  if (/only an issued invoice/i.test(message)) return "Only an issued invoice with an amount due can be paid from client funds.";
  if (/card payment on this invoice is processing/i.test(message)) return "A card payment on this invoice is processing. Wait until Stripe confirms or fails it.";
  if (/party on the matter/i.test(message)) return "The client must be a party on the matter.";
  if (/client account/i.test(message)) return "Choose the firm’s client account.";
  if (/future/i.test(message)) return "The date can’t be in the future.";
  if (/reason is required/i.test(message)) return "Give a short reason.";
  if (/pending verification/i.test(message)) return "This payment was already verified or rejected.";
  if (/waiting for approval/i.test(message)) return "This transfer was already approved or declined.";
  if (/already corrected/i.test(message)) return "This entry was already corrected.";
  if (/only a verified deposit or a refund/i.test(message)) return "Only a verified deposit or a refund can be corrected.";
  if (/only CAD/i.test(message)) return "Client funds are in CAD.";
  if (/last four digits/i.test(message)) return "Enter only the last four digits of the account number.";
  if (/method is invalid/i.test(message)) return "Choose how it was paid.";
  if (/amount must be positive/i.test(message)) return "Enter an amount above zero.";
  if (/idempotency key|too long/i.test(message)) return "Check the form and try again.";
  return safeAccessError(message);
}
