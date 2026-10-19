/**
 * An issued invoice as a PDF, in the shared receipt layout (`receipt-pdf.ts`). Drawn each time from
 * the invoice row as the signed-in person reads it (RLS), so it shows what the invoice says now:
 * its total, what was paid, credited and refunded, and what is still due. Nothing is stored.
 */
import { formatMoney } from "@/modules/agreements/pdf-text";
import { amountDue } from "@/modules/finance/corrections-present";
import { firmLine, licenseeLine, longDate, renderReceiptLayout } from "@/modules/finance/receipt-pdf";
import { FEE_CATEGORY_LABEL } from "@/modules/sheet/finance-present";

export type InvoicePdf = {
  number: string;
  description: string;
  feeCategory: string;
  status: string;
  amountCents: number;
  paidCents: number;
  creditedCents: number;
  refundedCents: number;
  currency: string;
  issuedOn: string | null;
  dueOn: string;
  createdAt: string;
  clientName: string;
  matterLabel: string;
  firmLegalName: string;
  firmDisplayName: string;
  consultantName: string | null;
  consultantLicence: string | null;
  isSample: boolean;
};

export const INVOICE_NOTE = "An issued invoice can’t be edited. Corrections are made with a credit note; a payment counts once Stripe confirms it or a transfer from the client account is approved.";

/** The invoice's label / value rows, in order. Pure, for the PDF and its tests. */
export function invoiceRows(invoice: InvoicePdf): [string, string][] {
  const money = (minor: number) => formatMoney(minor, invoice.currency) ?? "—";
  const licensee = licenseeLine(invoice);
  const due = amountDue({
    status: invoice.status,
    amountCents: invoice.amountCents,
    paidCents: invoice.paidCents,
    creditedCents: invoice.creditedCents,
    refundedCents: invoice.refundedCents,
  });
  return [
    ["Invoice", invoice.number],
    ["For", invoice.description],
    ["Category", FEE_CATEGORY_LABEL[invoice.feeCategory] ?? "Fee"],
    ["Total", money(invoice.amountCents)],
    ...(invoice.paidCents > 0 ? [["Paid", money(invoice.paidCents)] as [string, string]] : []),
    ...(invoice.creditedCents > 0 ? [["Credited", money(invoice.creditedCents)] as [string, string]] : []),
    ...(invoice.refundedCents > 0 ? [["Refunded", money(invoice.refundedCents)] as [string, string]] : []),
    [invoice.status === "voided" ? "Voided" : "Amount due", invoice.status === "voided" ? "Nothing is due" : money(due)],
    ["Issued", invoice.issuedOn ? longDate(invoice.issuedOn) : "—"],
    [due > 0 ? "Due by" : "Was due", longDate(invoice.dueOn)],
    ["Billed to", invoice.clientName],
    ["Matter", invoice.matterLabel],
    ["Firm", firmLine(invoice)],
    ...(licensee ? [["Licensee", licensee] as [string, string]] : []),
  ];
}

export function invoiceFilename(invoice: Pick<InvoicePdf, "number">): string {
  return `invoice-${invoice.number.toLowerCase()}.pdf`;
}

export async function renderInvoicePdf(invoice: InvoicePdf): Promise<Uint8Array> {
  return renderReceiptLayout({
    number: invoice.number,
    issuedAt: invoice.createdAt,
    firmLegalName: invoice.firmLegalName,
    firmDisplayName: invoice.firmDisplayName,
    consultantName: invoice.consultantName,
    consultantLicence: invoice.consultantLicence,
    heading: "INVOICE",
    amountCents: invoice.amountCents,
    currency: invoice.currency,
    rows: invoiceRows(invoice),
    notes: [INVOICE_NOTE],
    isSample: invoice.isSample,
    title: `Invoice ${invoice.number}`,
  });
}
