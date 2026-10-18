/**
 * The receipt for a payment of an invoice (CICC Code of Professional Conduct, SOR/2022-128,
 * s. 33(3): "When a payment is received from a client, the licensee must provide the client with a
 * receipt that clearly indicates the invoice to which the payment relates").
 *
 * The database issues one receipt (`invoice_payment_receipts`, PR-0001 per firm) when a card payment
 * succeeds or a client-account transfer is approved and applied to the invoice, and copies the firm,
 * licensee, client, matter and invoice onto it. This module turns the `invoice_payment_receipt` RPC's
 * JSON into rows and draws the PDF in the shared receipt layout (`receipt-pdf.ts`).
 *
 * Email (deferred): the rows, title and filename here are pure, so a receipt email can reuse
 * `paymentReceiptRows` / `paymentReceiptTitle` for its body and `renderPaymentReceiptPdf` for an
 * attachment once the owner's HTML template exists. The database side would enqueue the outbox
 * event in `app.issue_invoice_payment_receipt` (see the migration's note).
 */
import { formatInZone, formatMoney } from "@/modules/agreements/pdf-text";
import { firmLine, licenseeLine, longDate, renderReceiptLayout, str } from "@/modules/finance/receipt-pdf";

export type InvoicePaymentReceipt = {
  number: string;
  source: "card" | "client_funds";
  issuedAt: string;
  paidOn: string;
  amountCents: number;
  currency: string;
  method: "card" | "client_account";
  reference: string | null;
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
  accountLabel: string | null;
  accountInstitution: string | null;
  accountLast4: string | null;
  /** Stripe card brand (e.g. "visa") and last four digits, when known. Brand and last 4 only. */
  cardBrand: string | null;
  cardLast4: string | null;
  isSample: boolean;
};

function cents(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

/** The `invoice_payment_receipt` RPC's JSON, checked. Null when anything required is missing. */
export function paymentReceiptFromRpc(data: unknown): InvoicePaymentReceipt | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const amount = cents(row.amount_cents);
  const invoiceAmount = cents(row.invoice_amount_cents);
  const required = {
    number: str(row.number),
    issuedAt: str(row.issued_at),
    paidOn: str(row.paid_on),
    currency: str(row.currency),
    invoiceNumber: str(row.invoice_number),
    invoiceDescription: str(row.invoice_description),
    clientName: str(row.client_name),
    matterLabel: str(row.matter_label),
    firmLegalName: str(row.firm_legal_name),
    firmDisplayName: str(row.firm_display_name),
  };
  const source = row.source === "card" || row.source === "client_funds" ? row.source : null;
  const method = row.method === "card" || row.method === "client_account" ? row.method : null;
  if (Object.values(required).some((value) => value === null) || !source || !method) return null;
  if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(invoiceAmount) || invoiceAmount <= 0) return null;
  const accountLabel = str(row.account_label);
  const accountInstitution = str(row.account_institution);
  const accountLast4 = str(row.account_last4);
  if (method === "client_account" && (!accountLabel || !accountInstitution || !accountLast4)) return null;
  const cardBrand = str(row.card_brand);
  const cardLast4 = str(row.card_last4);
  const card = method === "card" && cardBrand && cardLast4 && /^[0-9]{4}$/.test(cardLast4) ? { cardBrand, cardLast4 } : { cardBrand: null, cardLast4: null };
  return {
    ...(required as { [K in keyof typeof required]: string }),
    source,
    method,
    amountCents: amount,
    invoiceAmountCents: invoiceAmount,
    reference: str(row.reference),
    invoiceIssuedOn: str(row.invoice_issued_on),
    firmTimezone: str(row.firm_timezone) ?? "America/Toronto",
    consultantName: str(row.consultant_name),
    consultantLicence: str(row.consultant_licence),
    accountLabel,
    accountInstitution,
    accountLast4,
    ...card,
    isSample: row.is_sample === true,
  };
}

/** "INV-0001 — Preparation stage (issued 18 October 2026, total CAD 1,130.00)": the invoice s. 33(3) asks for. */
export function invoiceLine(
  receipt: Pick<InvoicePaymentReceipt, "invoiceNumber" | "invoiceDescription" | "invoiceIssuedOn" | "invoiceAmountCents" | "currency">,
): string {
  const facts = [receipt.invoiceIssuedOn ? `issued ${longDate(receipt.invoiceIssuedOn)}` : null, `total ${formatMoney(receipt.invoiceAmountCents, receipt.currency)}`].filter(Boolean);
  return `${receipt.invoiceNumber} — ${receipt.invoiceDescription} (${facts.join(", ")})`;
}

/** Stripe's card brand codes, as people write them. An unknown brand reads "Card". */
const CARD_BRANDS: Record<string, string> = {
  amex: "American Express",
  american_express: "American Express",
  cartes_bancaires: "Cartes Bancaires",
  diners: "Diners Club",
  diners_club: "Diners Club",
  discover: "Discover",
  eftpos_au: "eftpos",
  interac: "Interac",
  jcb: "JCB",
  link: "Link",
  mastercard: "Mastercard",
  unionpay: "UnionPay",
  visa: "Visa",
};

/** "Visa" from "visa"; "Card" for "unknown" or a brand Casevoya doesn't name. */
export function cardBrandName(brand: string | null | undefined): string {
  return (brand && CARD_BRANDS[brand.trim().toLowerCase()]) || "Card";
}

/**
 * How it was paid. A card payment reads "Visa ••••4242" when Stripe gave the brand and last 4
 * (stored from the verified webhook; nothing else about the card is kept), otherwise "Card". A
 * transfer names the firm's client account it came from (institution and last four digits only).
 */
export function paymentMethodLine(
  receipt: Pick<InvoicePaymentReceipt, "method" | "accountLabel" | "accountInstitution" | "accountLast4"> &
    Partial<Pick<InvoicePaymentReceipt, "cardBrand" | "cardLast4">>,
): string {
  if (receipt.method === "card") return receipt.cardLast4 ? `${cardBrandName(receipt.cardBrand)} ••••${receipt.cardLast4}` : "Card";
  return `Transfer from the firm’s client account at ${receipt.accountInstitution} ••• ${receipt.accountLast4} (${receipt.accountLabel}), from money held for the client`;
}

export function paymentReferenceLine(receipt: Pick<InvoicePaymentReceipt, "method" | "reference">): string {
  if (!receipt.reference) return "None";
  return receipt.method === "card" ? `Card processor ${receipt.reference}` : `Client-account entry ${receipt.reference}`;
}

export const PAYMENT_RECEIPT_RULE =
  "Receipt for a payment of an invoice, provided under subsection 33(3) of the Code of Professional Conduct for College of Immigration and Citizenship Consultants Licensees (SOR/2022-128).";

export const PAYMENT_RECEIPT_REFUNDS = "A later refund is recorded separately; this receipt stays as it was issued.";

/** "Receipt PR-0001", as the pages and the PDF title show it. */
export function paymentReceiptTitle(receipt: Pick<InvoicePaymentReceipt, "number">): string {
  return `Receipt ${receipt.number}`;
}

/** The receipt's label / value rows, in order, with the invoice right after the amount. Pure. */
export function paymentReceiptRows(receipt: InvoicePaymentReceipt): [string, string][] {
  const licensee = licenseeLine(receipt);
  return [
    ["Receipt number", receipt.number],
    ["Amount received", formatMoney(receipt.amountCents, receipt.currency) ?? "—"],
    ["For invoice", invoiceLine(receipt)],
    ["Date paid", longDate(receipt.paidOn)],
    ["Received from", receipt.clientName],
    ["Matter", receipt.matterLabel],
    ["Method", paymentMethodLine(receipt)],
    ["Reference", paymentReferenceLine(receipt)],
    ["Firm", firmLine(receipt)],
    ...(licensee ? [["Licensee", licensee] as [string, string]] : []),
    ["Issued", formatInZone(receipt.issuedAt, receipt.firmTimezone)],
  ];
}

export function paymentReceiptFilename(receipt: Pick<InvoicePaymentReceipt, "number">): string {
  return `receipt-${receipt.number.toLowerCase()}.pdf`;
}

export { paymentReceiptHref } from "@/modules/finance/receipt-links";

export async function renderPaymentReceiptPdf(receipt: InvoicePaymentReceipt): Promise<Uint8Array> {
  return renderReceiptLayout({
    number: receipt.number,
    issuedAt: receipt.issuedAt,
    firmLegalName: receipt.firmLegalName,
    firmDisplayName: receipt.firmDisplayName,
    consultantName: receipt.consultantName,
    consultantLicence: receipt.consultantLicence,
    heading: "RECEIPT FOR PAYMENT OF INVOICE",
    amountCents: receipt.amountCents,
    currency: receipt.currency,
    rows: paymentReceiptRows(receipt),
    notes: [PAYMENT_RECEIPT_RULE, PAYMENT_RECEIPT_REFUNDS],
    isSample: receipt.isSample,
  });
}
