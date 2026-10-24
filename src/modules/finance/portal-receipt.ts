import type { PortalInvoice } from "@/modules/finance/portal-load";
import { formatMoney } from "@/modules/finance/money";
import { paymentMethodLine, type InvoicePaymentReceipt } from "@/modules/finance/payment-receipt";
import { invoicePdfHref, paymentReceiptHref } from "@/modules/finance/receipt-links";

/** The client's on-screen receipt (design/portal/pages/portal-receipt.html), from the issued receipt row. */
export type ReceiptView = {
  firm: string;
  number: string;
  date: string;
  amount: string;
  rows: [string, string][];
  note: string;
  pdfHref: string;
  invoiceHref: string | null;
  invoiceNumber: string;
  stillToPay: { line: string; href: string } | null;
  sample: boolean;
};

function day(isoDate: string): string {
  const date = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date).replace("Sept", "Sep");
}

function dueDay(isoDate: string): string {
  return day(isoDate).replace(/ \d{4}$/, "");
}

export function receiptView(input: {
  receipt: InvoicePaymentReceipt;
  receiptId: string;
  organizationId: string;
  invoices: PortalInvoice[];
}): ReceiptView {
  const { receipt } = input;
  const firm = receipt.firmDisplayName;
  const invoice = input.invoices.find((row) => row.number === receipt.invoiceNumber) ?? null;
  const due = (row: PortalInvoice) => Math.max(0, row.amountCents - row.paidCents - row.creditedCents);
  const open = input.invoices.filter((row) => row.open && due(row) > 0).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const next = open.find((row) => row.number === receipt.invoiceNumber) ?? open[0] ?? null;
  const rows: [string, string][] = [
    ["Paid by", receipt.clientName],
    ["For", `Invoice ${receipt.invoiceNumber} · ${receipt.invoiceDescription}`],
    ["Paid to", receipt.firmLegalName],
    ["Method", paymentMethodLine(receipt)],
    ["Matter", receipt.matterLabel],
  ];
  if (receipt.reference && receipt.method !== "card") rows.push(["Reference", receipt.reference]);
  if (receipt.consultantName) rows.push(["Consultant", receipt.consultantLicence ? `${receipt.consultantName} (${receipt.consultantLicence})` : receipt.consultantName]);
  return {
    firm,
    number: receipt.number,
    date: day(receipt.paidOn),
    amount: formatMoney(receipt.amountCents, receipt.currency),
    rows,
    note:
      receipt.method === "card"
        ? `Paid through Stripe. ${firm} and Casevoya never saw your full card number. Questions about this payment go to ${firm}, not Casevoya.`
        : `Paid from money ${firm} held for you in its client account. Questions about this payment go to ${firm}, not Casevoya.`,
    pdfHref: paymentReceiptHref(input.receiptId, input.organizationId),
    invoiceHref: invoice ? (invoice.open ? `/portal/pay?invoice=${invoice.id}` : invoicePdfHref(invoice.id, input.organizationId)) : null,
    invoiceNumber: receipt.invoiceNumber,
    stillToPay: next ? { line: `${formatMoney(due(next), next.currency)} on ${next.number}, due ${dueDay(next.dueOn)}.`, href: `/portal/pay?invoice=${next.id}` } : null,
    sample: receipt.isSample,
  };
}
