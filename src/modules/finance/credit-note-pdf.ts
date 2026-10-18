/**
 * The credit note PDF, in the shared receipt layout (`receipt-pdf.ts`). The database issues the
 * credit note (`invoice_credit_notes`, CN-0001 per firm) and copies the firm, licensee, client,
 * matter and invoice onto it when it is issued; this module turns the `invoice_credit_note` RPC's
 * JSON into rows and draws the page. The CICC Code quoted in docs/legal/client-account-sources.md
 * says nothing about credit notes, so no rule is cited on it: it is a product record (FIN-06).
 */
import { formatInZone, formatMoney } from "@/modules/agreements/pdf-text";
import { invoiceLine } from "@/modules/finance/payment-receipt";
import { firmLine, licenseeLine, renderReceiptLayout, str } from "@/modules/finance/receipt-pdf";

export type CreditNote = {
  number: string;
  issuedAt: string;
  amountCents: number;
  currency: string;
  reason: string;
  appliedCents: number;
  creditBalanceCents: number;
  invoiceNumber: string;
  invoiceDescription: string;
  invoiceIssuedOn: string | null;
  invoiceAmountCents: number;
  clientName: string;
  matterLabel: string;
  firmLegalName: string;
  firmDisplayName: string;
  firmTimezone: string;
  consultantName: string | null;
  consultantLicence: string | null;
  isSample: boolean;
};

function cents(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

/** The `invoice_credit_note` RPC's JSON, checked. Null when anything required is missing. */
export function creditNoteFromRpc(data: unknown): CreditNote | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const required = {
    number: str(row.number),
    issuedAt: str(row.issued_at),
    currency: str(row.currency),
    reason: str(row.reason),
    invoiceNumber: str(row.invoice_number),
    invoiceDescription: str(row.invoice_description),
    clientName: str(row.client_name),
    matterLabel: str(row.matter_label),
    firmLegalName: str(row.firm_legal_name),
    firmDisplayName: str(row.firm_display_name),
  };
  const amount = cents(row.amount_cents);
  const applied = cents(row.applied_cents);
  const balance = cents(row.credit_balance_cents);
  const invoiceAmount = cents(row.invoice_amount_cents);
  if (Object.values(required).some((value) => value === null)) return null;
  if (![amount, applied, balance, invoiceAmount].every((value) => Number.isSafeInteger(value) && value >= 0) || amount <= 0 || invoiceAmount <= 0) return null;
  if (applied + balance !== amount) return null;
  return {
    ...(required as { [K in keyof typeof required]: string }),
    amountCents: amount,
    appliedCents: applied,
    creditBalanceCents: balance,
    invoiceAmountCents: invoiceAmount,
    invoiceIssuedOn: str(row.invoice_issued_on),
    firmTimezone: str(row.firm_timezone) ?? "America/Toronto",
    consultantName: str(row.consultant_name),
    consultantLicence: str(row.consultant_licence),
    isSample: row.is_sample === true,
  };
}

export const CREDIT_NOTE_MONEY =
  "A credit note reduces what is owed on the invoice. It does not send money back: any refund is made and recorded separately.";

/** The note's label / value rows, in order, the invoice right after the amount. Pure. */
export function creditNoteRows(note: CreditNote): [string, string][] {
  const licensee = licenseeLine(note);
  const money = (minor: number) => formatMoney(minor, note.currency) ?? "—";
  return [
    ["Credit note", note.number],
    ["Amount credited", money(note.amountCents)],
    ["Against invoice", invoiceLine(note)],
    ["Reason", note.reason],
    ["Reduces amount due by", money(note.appliedCents)],
    ...(note.creditBalanceCents > 0 ? [["Credit owed to the client", `${money(note.creditBalanceCents)}, refunded separately`] as [string, string]] : []),
    ["Client", note.clientName],
    ["Matter", note.matterLabel],
    ["Firm", firmLine(note)],
    ...(licensee ? [["Licensee", licensee] as [string, string]] : []),
    ["Issued", formatInZone(note.issuedAt, note.firmTimezone)],
  ];
}

export function creditNoteFilename(note: Pick<CreditNote, "number">): string {
  return `credit-note-${note.number.toLowerCase()}.pdf`;
}

export async function renderCreditNotePdf(note: CreditNote): Promise<Uint8Array> {
  return renderReceiptLayout({
    number: note.number,
    issuedAt: note.issuedAt,
    firmLegalName: note.firmLegalName,
    firmDisplayName: note.firmDisplayName,
    consultantName: note.consultantName,
    consultantLicence: note.consultantLicence,
    heading: "CREDIT NOTE",
    amountCents: note.amountCents,
    currency: note.currency,
    rows: creditNoteRows(note),
    notes: [CREDIT_NOTE_MONEY],
    isSample: note.isSample,
    title: `Credit note ${note.number}`,
  });
}
