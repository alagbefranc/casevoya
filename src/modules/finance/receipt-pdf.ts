/**
 * The receipt for an advance payment (CICC Code of Professional Conduct, SOR/2022-128, s. 32(b):
 * "provide the client with a receipt that clearly indicates the amount of the advance payment").
 *
 * Rendered by the app server with pdf-lib, the same way as the sealed agreement PDF: standard
 * Helvetica with WinAnsi (French accents render), nothing embedded, runs on Node and Workers. The
 * input is the receipt row the database issued when the deposit was verified; names on it were
 * copied at that time, so the PDF reads the same every time it is downloaded.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatInZone, formatMoney, pdfSafeText, wrapText } from "@/modules/agreements/pdf-text";
import { CLIENT_FUND_METHODS } from "@/modules/finance/client-funds-present";

export type ClientFundReceipt = {
  number: string;
  issuedAt: string;
  receivedOn: string;
  amountCents: number;
  currency: string;
  method: string;
  reference: string | null;
  clientName: string;
  matterLabel: string;
  firmLegalName: string;
  firmDisplayName: string;
  firmTimezone: string;
  consultantName: string | null;
  consultantLicence: string | null;
  accountLabel: string;
  accountInstitution: string;
  accountLast4: string;
  isSample: boolean;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** The `client_fund_receipt` RPC's JSON, checked. Null when anything required is missing. */
export function receiptFromRpc(data: unknown): ClientFundReceipt | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const amount = typeof row.amount_cents === "number" ? row.amount_cents : Number(row.amount_cents);
  const required = {
    number: str(row.number),
    issuedAt: str(row.issued_at),
    receivedOn: str(row.received_on),
    currency: str(row.currency),
    method: str(row.method),
    clientName: str(row.client_name),
    matterLabel: str(row.matter_label),
    firmLegalName: str(row.firm_legal_name),
    firmDisplayName: str(row.firm_display_name),
    accountLabel: str(row.account_label),
    accountInstitution: str(row.account_institution),
    accountLast4: str(row.account_last4),
  };
  if (Object.values(required).some((value) => value === null) || !Number.isSafeInteger(amount) || amount <= 0) return null;
  return {
    ...(required as { [K in keyof typeof required]: string }),
    amountCents: amount,
    reference: str(row.reference),
    firmTimezone: str(row.firm_timezone) ?? "America/Toronto",
    consultantName: str(row.consultant_name),
    consultantLicence: str(row.consultant_licence),
    isSample: row.is_sample === true,
  };
}

/** "18 October 2026" from a `YYYY-MM-DD` date. */
export function longDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day || month > 12) return date;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export function firmLine(receipt: Pick<ClientFundReceipt, "firmLegalName" | "firmDisplayName">): string {
  return receipt.firmLegalName === receipt.firmDisplayName ? receipt.firmLegalName : `${receipt.firmLegalName} (${receipt.firmDisplayName})`;
}

/** "Jane Roe, CICC licence RCIC R000001". Nothing is invented when no licence is on file. */
export function licenseeLine(receipt: Pick<ClientFundReceipt, "consultantName" | "consultantLicence">): string | null {
  const licence = receipt.consultantLicence ? `CICC licence ${receipt.consultantLicence}` : null;
  const parts = [receipt.consultantName, licence].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export function heldIn(receipt: Pick<ClientFundReceipt, "accountLabel" | "accountInstitution" | "accountLast4">): string {
  return `Held in the firm’s client account at ${receipt.accountInstitution} ••• ${receipt.accountLast4} (${receipt.accountLabel})`;
}

export const RECEIPT_RULE =
  "Receipt for an advance payment, provided under paragraph 32(b) of the Code of Professional Conduct for College of Immigration and Citizenship Consultants Licensees (SOR/2022-128).";

export const RECEIPT_HOLDING =
  "The advance is held in trust in the firm’s client account until services are provided and invoiced. Casevoya records the firm’s client account; it does not hold client money.";

export const SAMPLE_NOTICE = "Fictional sample. Not a client record.";

/** The receipt's label / value rows, in order. Pure, for the PDF and its tests. */
export function receiptRows(receipt: ClientFundReceipt): [string, string][] {
  const method = CLIENT_FUND_METHODS.find((item) => item.value === receipt.method)?.label.replace(/ \(.*\)$/, "") ?? receipt.method;
  const licensee = licenseeLine(receipt);
  return [
    ["Receipt number", receipt.number],
    ["Amount received", formatMoney(receipt.amountCents, receipt.currency) ?? "—"],
    ["Date received", longDate(receipt.receivedOn)],
    ["Received from", receipt.clientName],
    ["Matter", receipt.matterLabel],
    ["Method", method],
    ["Reference", receipt.reference ?? "None given"],
    ["Held in", heldIn(receipt)],
    ["Firm", firmLine(receipt)],
    ...(licensee ? [["Licensee", licensee] as [string, string]] : []),
    ["Issued", formatInZone(receipt.issuedAt, receipt.firmTimezone)],
  ];
}

export function receiptFilename(receipt: Pick<ClientFundReceipt, "number">): string {
  return `receipt-${receipt.number.toLowerCase()}.pdf`;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const INK = rgb(0.11, 0.12, 0.15);
const MUTED = rgb(0.38, 0.4, 0.45);
const HAIRLINE = rgb(0.82, 0.83, 0.86);
const ACCENT = rgb(0.13, 0.22, 0.4);
const WARN = rgb(0.6, 0.33, 0.05);

function drawLines(page: PDFPage, text: string, font: PDFFont, size: number, x: number, y: number, width: number, color = INK): number {
  let cursor = y;
  for (const line of wrapText(pdfSafeText(text), width, (value) => font.widthOfTextAtSize(value, size))) {
    cursor -= size;
    page.drawText(line, { x, y: cursor, size, font, color });
    cursor -= size * 0.4;
  }
  return cursor;
}

/** One page: firm, title, the rows, the rule it is given under, and the sample notice when it is one. */
export async function renderReceiptPdf(receipt: ClientFundReceipt): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafeText(`Receipt ${receipt.number}`));
  doc.setAuthor(pdfSafeText(receipt.firmLegalName));
  doc.setCreator("Casevoya");
  doc.setProducer("Casevoya (pdf-lib)");
  const fixed = new Date(receipt.issuedAt);
  if (!Number.isNaN(fixed.getTime())) {
    doc.setCreationDate(fixed);
    doc.setModificationDate(fixed);
  }
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  let y = PAGE_HEIGHT - 56;
  y = drawLines(page, receipt.firmDisplayName, bold, 15, MARGIN_X, y, CONTENT_WIDTH);
  if (receipt.firmLegalName !== receipt.firmDisplayName) y = drawLines(page, receipt.firmLegalName, regular, 9, MARGIN_X, y, CONTENT_WIDTH, MUTED);
  const licensee = licenseeLine(receipt);
  if (licensee) y = drawLines(page, licensee, regular, 9, MARGIN_X, y, CONTENT_WIDTH, MUTED);
  y -= 18;
  y = drawLines(page, "RECEIPT FOR ADVANCE PAYMENT", bold, 9, MARGIN_X, y, CONTENT_WIDTH, ACCENT);
  y -= 4;
  page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_WIDTH - MARGIN_X, y }, thickness: 0.6, color: HAIRLINE });
  y -= 10;
  y = drawLines(page, formatMoney(receipt.amountCents, receipt.currency) ?? "", bold, 22, MARGIN_X, y, CONTENT_WIDTH);
  y -= 12;

  const labelWidth = 120;
  for (const [label, value] of receiptRows(receipt)) {
    const top = y;
    const after = drawLines(page, value, regular, 10, MARGIN_X + labelWidth, top, CONTENT_WIDTH - labelWidth);
    drawLines(page, label, bold, 9, MARGIN_X, top - 0.5, labelWidth - 8, MUTED);
    y = after - 6;
  }

  y -= 10;
  page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_WIDTH - MARGIN_X, y }, thickness: 0.6, color: HAIRLINE });
  y -= 8;
  y = drawLines(page, RECEIPT_RULE, regular, 8.5, MARGIN_X, y, CONTENT_WIDTH, MUTED);
  y -= 4;
  y = drawLines(page, RECEIPT_HOLDING, regular, 8.5, MARGIN_X, y, CONTENT_WIDTH, MUTED);
  if (receipt.isSample) {
    y -= 8;
    drawLines(page, SAMPLE_NOTICE, bold, 10, MARGIN_X, y, CONTENT_WIDTH, WARN);
  }
  return doc.save({ useObjectStreams: false });
}
