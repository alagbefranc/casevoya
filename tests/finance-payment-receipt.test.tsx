import { PDFDocument } from "pdf-lib";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaymentsLive } from "@/components/portal/payments-live";
import { SheetFinancePayments } from "@/components/sheet/designer/finance";
import { ledgerLines, type FundEntry } from "@/modules/finance/client-funds-present";
import {
  cardBrandName,
  invoiceLine,
  PAYMENT_RECEIPT_REFUNDS,
  PAYMENT_RECEIPT_RULE,
  paymentMethodLine,
  paymentReceiptFilename,
  paymentReceiptFromRpc,
  paymentReceiptHref,
  paymentReceiptRows,
  paymentReceiptTitle,
  renderPaymentReceiptPdf,
  type InvoicePaymentReceipt,
} from "@/modules/finance/payment-receipt";
import { RECEIPT_RULE, renderReceiptPdf, SAMPLE_NOTICE } from "@/modules/finance/receipt-pdf";
import type { PortalInvoice, PortalInvoices } from "@/modules/finance/portal-load";
import type { PortalViewer } from "@/modules/portal/load";
import { dayMonth } from "@/modules/sheet/home-present";
import { pdfText } from "./helpers/pdf-text";

const ORG = "11111111-1111-4111-8111-111111111111";
const RECEIPT_ID = "22222222-2222-4222-8222-222222222222";

/** The invoice_payment_receipt RPC's JSON for a card payment, synthetic values only. */
const CARD = {
  number: "PR-0001",
  source: "card",
  issued_at: "2026-10-18T18:05:07.000Z",
  paid_at: "2026-10-18T18:05:06.000Z",
  paid_on: "2026-10-18",
  amount_cents: 113_000,
  currency: "CAD",
  method: "card",
  reference: "pi_3SyntheticIntent01",
  invoice_number: "INV-0001",
  invoice_description: "Préparation de la demande",
  invoice_issued_on: "2026-10-16",
  invoice_amount_cents: 113_000,
  client_name: "Zoé Synthétique",
  matter_label: "CA-2026-0001 · Synthetic matter",
  firm_legal_name: "Synthetic Legal Name Inc.",
  firm_display_name: "Synthetic Firm",
  firm_timezone: "America/Toronto",
  consultant_name: "Synthetic Consultant",
  consultant_licence: "RCIC R000001",
  account_label: null,
  account_institution: null,
  account_last4: null,
  is_sample: false,
};

const TRANSFER = {
  ...CARD,
  number: "PR-0002",
  source: "client_funds",
  method: "client_account",
  reference: "CF-0004",
  amount_cents: 30_000,
  account_label: "Client account",
  account_institution: "Synthetic Bank",
  account_last4: "4410",
};

function parse(data: Record<string, unknown>): InvoicePaymentReceipt {
  const parsed = paymentReceiptFromRpc(data);
  if (!parsed) throw new Error("fixture did not parse");
  return parsed;
}

describe("invoice payment receipt presenter (CICC Code s. 33(3))", () => {
  it("parses the RPC and refuses one missing what the receipt must show", () => {
    expect(parse(CARD)).toMatchObject({ number: "PR-0001", source: "card", method: "card", invoiceNumber: "INV-0001", amountCents: 113_000, accountLast4: null });
    expect(paymentReceiptFromRpc({ ...CARD, invoice_number: "" })).toBeNull();
    expect(paymentReceiptFromRpc({ ...CARD, amount_cents: 0 })).toBeNull();
    expect(paymentReceiptFromRpc({ ...CARD, method: "cheque" })).toBeNull();
    expect(paymentReceiptFromRpc({ ...TRANSFER, account_last4: null })).toBeNull();
    expect(paymentReceiptFromRpc(null)).toBeNull();
    expect(paymentReceiptFromRpc({ ...CARD, consultant_name: null, consultant_licence: null, invoice_issued_on: null, reference: null })).toMatchObject({
      consultantLicence: null,
      invoiceIssuedOn: null,
      reference: null,
    });
  });

  it("names the invoice the payment relates to, right after the amount", () => {
    const rows = paymentReceiptRows(parse(CARD));
    expect(rows.slice(0, 3).map(([label]) => label)).toEqual(["Receipt number", "Amount received", "For invoice"]);
    expect(Object.fromEntries(rows)).toEqual({
      "Receipt number": "PR-0001",
      "Amount received": "CAD 1,130.00",
      "For invoice": "INV-0001 — Préparation de la demande (issued 16 October 2026, total CAD 1,130.00)",
      "Date paid": "18 October 2026",
      "Received from": "Zoé Synthétique",
      Matter: "CA-2026-0001 · Synthetic matter",
      Method: "Card",
      Reference: "Card processor pi_3SyntheticIntent01",
      Firm: "Synthetic Legal Name Inc. (Synthetic Firm)",
      Licensee: "Synthetic Consultant, CICC licence RCIC R000001",
      Issued: "18 October 2026, 14:05:07 EDT",
    });
    expect(invoiceLine({ invoiceNumber: "INV-0002", invoiceDescription: "Fee", invoiceIssuedOn: null, invoiceAmountCents: 500, currency: "CAD" })).toBe("INV-0002 — Fee (total CAD 5.00)");
  });

  it("says a card payment was by card only, and a transfer which client account it came from", () => {
    expect(paymentMethodLine(parse(CARD))).toBe("Card");
    const transfer = Object.fromEntries(paymentReceiptRows(parse(TRANSFER)));
    expect(transfer.Method).toBe("Transfer from the firm’s client account at Synthetic Bank ••• 4410 (Client account), from money held for the client");
    expect(transfer.Reference).toBe("Client-account entry CF-0004");
    const bare = Object.fromEntries(paymentReceiptRows(parse({ ...CARD, consultant_name: null, consultant_licence: null, reference: null })));
    expect(bare).not.toHaveProperty("Licensee");
    expect(bare.Reference).toBe("None");
    expect(paymentReceiptTitle({ number: "PR-0012" })).toBe("Receipt PR-0012");
    expect(paymentReceiptFilename({ number: "PR-0012" })).toBe("receipt-pr-0012.pdf");
    expect(paymentReceiptHref(RECEIPT_ID, ORG)).toBe(`/api/invoices/receipts/${RECEIPT_ID}?organizationId=${ORG}`);
  });

  it("renders a one-page PDF in the shared receipt layout, with the s. 33(3) rule and accents intact", async () => {
    const bytes = await renderPaymentReceiptPdf(parse(CARD));
    expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("Receipt PR-0001");
    const text = pdfText(bytes);
    for (const value of ["RECEIPT FOR PAYMENT OF INVOICE", "PR-0001", "CAD 1,130.00", "INV-0001", "Préparation de la demande", "Zoé Synthétique", "CICC licence RCIC R000001"]) {
      expect(text).toContain(value);
    }
    const flat = text.replace(/\s+/g, " ");
    expect(flat).toContain(PAYMENT_RECEIPT_RULE.slice(0, 40));
    expect(flat).toContain(PAYMENT_RECEIPT_REFUNDS.slice(0, 30));
    expect(text).not.toContain(SAMPLE_NOTICE);
    expect(Buffer.from(await renderPaymentReceiptPdf(parse(CARD))).equals(Buffer.from(bytes))).toBe(true);
    expect(pdfText(await renderPaymentReceiptPdf(parse({ ...TRANSFER, is_sample: true })))).toContain(SAMPLE_NOTICE);
  });

  it("prints the card brand and last 4 when Stripe gave them, and \"Card\" when not", async () => {
    const visa = parse({ ...CARD, card_brand: "visa", card_last4: "4242" });
    expect(visa).toMatchObject({ cardBrand: "visa", cardLast4: "4242" });
    expect(paymentMethodLine(visa)).toBe("Visa ••••4242");
    expect(Object.fromEntries(paymentReceiptRows(visa)).Method).toBe("Visa ••••4242");
    expect(paymentMethodLine(parse({ ...CARD, card_brand: "mastercard", card_last4: "4444" }))).toBe("Mastercard ••••4444");
    expect(paymentMethodLine(parse({ ...CARD, card_brand: "amex", card_last4: "0005" }))).toBe("American Express ••••0005");
    expect(paymentMethodLine(parse({ ...CARD, card_brand: "unknown", card_last4: "1234" }))).toBe("Card ••••1234");
    expect(paymentMethodLine(parse({ ...CARD, card_brand: null, card_last4: null }))).toBe("Card");
    // Half a card, a malformed last 4, or a card on a transfer is not shown.
    expect(paymentMethodLine(parse({ ...CARD, card_brand: "visa", card_last4: null }))).toBe("Card");
    expect(paymentMethodLine(parse({ ...CARD, card_brand: "visa", card_last4: "42" }))).toBe("Card");
    expect(parse({ ...TRANSFER, card_brand: "visa", card_last4: "4242" })).toMatchObject({ cardBrand: null, cardLast4: null });
    expect(cardBrandName("discover")).toBe("Discover");
    expect(cardBrandName("jcb")).toBe("JCB");
    expect(cardBrandName("unionpay")).toBe("UnionPay");
    expect(cardBrandName("diners")).toBe("Diners Club");
    expect(cardBrandName("cartes_bancaires")).toBe("Cartes Bancaires");
    expect(cardBrandName("interac")).toBe("Interac");
    expect(cardBrandName(null)).toBe("Card");

    const text = pdfText(await renderPaymentReceiptPdf(visa));
    expect(text).toContain("Visa ••••4242");
    const plain = pdfText(await renderPaymentReceiptPdf(parse(CARD)));
    expect(plain).not.toContain("••••");
    expect(plain).not.toContain("Visa");
  });

  it("leaves the advance receipt's layout and rule as they were", async () => {
    const text = pdfText(
      await renderReceiptPdf({
        number: "RC-0001",
        issuedAt: CARD.issued_at,
        receivedOn: "2026-10-16",
        amountCents: 5_000,
        currency: "CAD",
        method: "cash",
        reference: null,
        clientName: "Synthetic applicant",
        matterLabel: "Synthetic matter",
        firmLegalName: "Synthetic Firm",
        firmDisplayName: "Synthetic Firm",
        firmTimezone: "America/Toronto",
        consultantName: null,
        consultantLicence: null,
        accountLabel: "Client account",
        accountInstitution: "Synthetic Bank",
        accountLast4: "4410",
        isSample: false,
      }),
    );
    expect(text).toContain("RECEIPT FOR ADVANCE PAYMENT");
    expect(text.replace(/\s+/g, " ")).toContain(RECEIPT_RULE.slice(0, 40));
    expect(text).not.toContain("33(3)");
  });
});

describe("where the receipt shows", () => {
  it("links the receipt after the reference on a Finance Payments row", () => {
    const href = paymentReceiptHref(RECEIPT_ID, ORG);
    const html = renderToStaticMarkup(
      createElement(SheetFinancePayments, {
        data: {
          intro: "Synthetic firm",
          currency: "CAD",
          balance: null,
          rows: [
            { received: "18 Oct", from: "Dana Lee", method: "Card", reference: ["evt_…abc123"], goesTo: "INV-0001", amount: "1,130.00", state: { tone: "ok", label: "Received" }, receipt: { label: "Receipt PR-0001", href } },
            { received: "17 Oct", from: "Dana Lee", method: "Card", reference: ["evt_…def456"], goesTo: "INV-0002", amount: "50.00", state: { tone: "bad", label: "Payment failed" } },
          ],
          empty: null,
          note: ["Synthetic note"],
        },
      }),
    );
    expect(html).toContain(
      `<td>evt_…abc123 <span class="sep" aria-hidden="true"></span> <a href="${href}" class="num" style="color:var(--blue)" data-payment-receipt="1">Receipt PR-0001</a></td>`,
    );
    expect(html.match(/data-payment-receipt=/g)).toHaveLength(1);
  });

  it("links an approved transfer's PR- receipt on the client-funds ledger row", () => {
    const base: FundEntry = {
      id: "d",
      number: "CF-0001",
      kind: "deposit",
      status: "verified",
      direction: "in",
      amountCents: 50_000,
      occurredOn: "2026-10-14",
      method: "bank_transfer",
      reference: "TD-1",
      evidence: null,
      note: null,
      invoiceNumber: null,
      reversesNumber: null,
      recordedBy: "Sam Roe",
      verifiedBy: "Ana Owner",
      approvedBy: null,
      ownerSelfApproved: false,
      receiptNumber: "RC-0001",
    };
    const lines = ledgerLines(
      [
        base,
        { ...base, id: "t", number: "CF-0002", kind: "transfer", status: "approved", direction: "out", amountCents: 30_000, invoiceNumber: "INV-0001", approvedBy: "Ana Owner", receiptNumber: "PR-0001", paymentReceiptId: RECEIPT_ID },
        { ...base, id: "p", number: "CF-0003", kind: "transfer", status: "pending_approval", direction: "out", amountCents: 1_000, invoiceNumber: "INV-0002", receiptNumber: null },
      ],
      dayMonth,
      "CAD",
      (entry) => (entry.kind === "transfer" && entry.paymentReceiptId ? paymentReceiptHref(entry.paymentReceiptId, ORG) : `/api/client-funds/receipts/${entry.id}`),
    );
    expect(lines[0].receipt).toEqual({ label: "Receipt RC-0001", href: "/api/client-funds/receipts/d" });
    expect(lines[1].receipt).toEqual({ label: "Receipt PR-0001", href: paymentReceiptHref(RECEIPT_ID, ORG) });
    expect(lines[2].receipt).toBeUndefined();
  });

  it("lists each of the client's payment receipts on the portal invoice row", () => {
    const viewer = { organizationId: ORG, organizationName: "Synthetic Firm", timezone: "America/Toronto", matters: [] } as unknown as PortalViewer;
    const invoice = (partial: Partial<PortalInvoice>): PortalInvoice => ({
      id: "i1",
      number: "INV-0001",
      description: "Preparation stage",
      matterTitle: "Work permit",
      amountCents: 113_000,
      paidCents: 113_000,
      refundedCents: 0,
      creditedCents: 0,
      creditNotes: [],
      currency: "CAD",
      status: "paid",
      issuedOn: "2026-10-16",
      dueOn: "2026-10-30",
      open: false,
      processing: false,
      state: { tone: "ok", label: "Paid" },
      receipts: [],
      ...partial,
    });
    const data: PortalInvoices = {
      clientFunds: null,
      today: "2026-10-18",
      payable: true,
      publishableKey: null,
      invoices: [
        invoice({ receipts: [{ id: RECEIPT_ID, number: "PR-0001" }] }),
        invoice({ id: "i2", number: "INV-0002", status: "partially_paid", open: true, paidCents: 10_000, receipts: [{ id: "33333333-3333-4333-8333-333333333333", number: "PR-0002" }] }),
        invoice({ id: "i3", number: "INV-0003" }),
      ],
    };
    const html = renderToStaticMarkup(createElement(PaymentsLive, { viewer, data }));
    expect(html).toContain(
      `<a class="btn sm" href="/portal/receipt?id=${RECEIPT_ID}" aria-label="Open receipt PR-0001 for invoice INV-0001" data-payment-receipt="1">Receipt PR-0001</a>`,
    );
    // A partly paid invoice keeps its Pay button and shows the receipt for what was paid.
    expect(html).toMatch(/href="\/portal\/pay\?invoice=i2">Pay<\/a><span> <a class="btn sm"[^>]*>Receipt PR-0002<\/a><\/span>/);
    // A paid invoice without a receipt (none issued) still reads "Paid".
    expect(html.match(/<small>Paid<\/small>/g)).toHaveLength(1);
    expect(html.match(/data-payment-receipt=/g)).toHaveLength(2);
  });

  it("keeps \"Pending verification\" on the portal Payments list while a manual payment waits for the firm's check (#214)", () => {
    const viewer = { organizationId: ORG, organizationName: "Synthetic Firm", timezone: "America/Toronto", matters: [] } as unknown as PortalViewer;
    const base: PortalInvoice = {
      id: "i1",
      number: "INV-0001",
      description: "Preparation stage",
      matterTitle: "Work permit",
      amountCents: 113_000,
      paidCents: 0,
      refundedCents: 0,
      creditedCents: 0,
      creditNotes: [],
      currency: "CAD",
      status: "issued",
      issuedOn: "2026-10-16",
      dueOn: "2026-10-30",
      open: true,
      processing: false,
      state: { tone: "chg", label: "Issued" },
      receipts: [],
    };
    const data: PortalInvoices = {
      clientFunds: null,
      today: "2026-10-18",
      payable: true,
      publishableKey: null,
      invoices: [
        { ...base, pendingCents: 50_000, state: { tone: "rev", label: "Pending verification", detail: "CAD 500.00 recorded" } },
        { ...base, id: "i2", number: "INV-0002" },
      ],
    };
    const html = renderToStaticMarkup(createElement(PaymentsLive, { viewer, data }));
    expect(html).toContain('<span class="bd rev"><i></i><span>Pending verification <');
    expect(html).toContain("CAD 500.00 recorded");
    // An open invoice with nothing pending still shows its due date.
    expect(html).toContain(`<span class="bd chg"><i></i>Due ${dayMonth("2026-10-30")}</span>`);
  });
});
