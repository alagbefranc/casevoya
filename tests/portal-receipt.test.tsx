import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LivePortal } from "@/components/portal/live";
import type { PortalInvoice } from "@/modules/finance/portal-load";
import type { InvoicePaymentReceipt } from "@/modules/finance/payment-receipt";
import { receiptView } from "@/modules/finance/portal-receipt";
import type { PortalViewer } from "@/modules/portal/load";

// The client's on-screen receipt (docs/specs/client-portal-fidelity.md §4): the issued receipt as
// a page, with its PDF, Print and the invoice, and what is still to pay. Everything is synthetic.

const ORG = "00000000-0000-4000-8000-000000000001";
const RECEIPT = "33333333-3333-4333-8333-333333333333";

const receipt: InvoicePaymentReceipt = {
  number: "PR-0014",
  source: "card",
  issuedAt: "2026-10-08T15:00:00Z",
  paidOn: "2026-10-08",
  amountCents: 113000,
  currency: "CAD",
  method: "card",
  reference: null,
  invoiceNumber: "INV-0201",
  invoiceDescription: "first half (preparation stage)",
  invoiceIssuedOn: "2026-09-04",
  invoiceAmountCents: 226000,
  clientName: "Jordan Lee, for Casey Nguyen",
  matterLabel: "Spousal sponsorship · EX-2026-0142",
  firmLegalName: "Example Immigration Inc.",
  firmDisplayName: "Example Immigration",
  firmTimezone: "America/Toronto",
  consultantName: "Dana Moreau",
  consultantLicence: "R712000",
  accountLabel: null,
  accountInstitution: null,
  accountLast4: null,
  cardBrand: "visa",
  cardLast4: "4242",
  isSample: false,
};

function invoice(overrides: Partial<PortalInvoice>): PortalInvoice {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    number: "INV-0218",
    description: "",
    matterTitle: "Spousal sponsorship",
    amountCents: 113000,
    paidCents: 0,
    refundedCents: 0,
    creditedCents: 0,
    currency: "CAD",
    status: "open",
    issuedOn: "2026-10-06",
    dueOn: "2026-11-06",
    open: true,
    processing: false,
    state: { tone: "chg", label: "Due" },
    receipts: [],
    creditNotes: [],
    ...overrides,
  };
}

const viewer: PortalViewer = {
  organizationId: ORG,
  organizationName: "Example Immigration",
  organizationSlug: "example",
  timezone: "America/Toronto",
  role: "client",
  person: null,
  matters: [],
  people: [],
  grants: [],
  shares: [],
  prefs: null,
  sections: [],
};

describe("portal receipt", () => {
  it("builds the receipt rows, PDF link, invoice link and what is still to pay", () => {
    const paid = invoice({ id: "22222222-2222-4222-8222-222222222222", number: "INV-0201", open: false, paidCents: 226000, amountCents: 226000 });
    const view = receiptView({ receipt, receiptId: RECEIPT, organizationId: ORG, invoices: [paid, invoice({})] });
    expect(view).toMatchObject({ firm: "Example Immigration", number: "PR-0014", date: "8 Oct 2026", amount: "CAD 1,130.00", invoiceNumber: "INV-0201" });
    expect(view.rows).toEqual([
      ["Paid by", "Jordan Lee, for Casey Nguyen"],
      ["For", "Invoice INV-0201 · first half (preparation stage)"],
      ["Paid to", "Example Immigration Inc."],
      ["Method", "Visa ••••4242"],
      ["Matter", "Spousal sponsorship · EX-2026-0142"],
      ["Consultant", "Dana Moreau (R712000)"],
    ]);
    expect(view.pdfHref).toBe(`/api/invoices/receipts/${RECEIPT}?organizationId=${ORG}`);
    expect(view.invoiceHref).toBe(`/api/invoices/pdf/22222222-2222-4222-8222-222222222222?organizationId=${ORG}`);
    expect(view.stillToPay).toEqual({ line: "CAD 1,130.00 on INV-0218, due 6 Nov.", href: "/portal/pay?invoice=11111111-1111-4111-8111-111111111111" });
    expect(view.note).toMatch(/^Paid through Stripe\. Example Immigration and Casevoya never saw your full card number\./);
  });

  it("says a client-account payment came from money held for the client, and nothing is still to pay when all is paid", () => {
    const view = receiptView({
      receipt: { ...receipt, method: "client_account", source: "client_funds", reference: "CF-0002", accountLabel: "Trust", accountInstitution: "Bank", accountLast4: "4410", cardBrand: null, cardLast4: null },
      receiptId: RECEIPT,
      organizationId: ORG,
      invoices: [],
    });
    expect(view.note).toMatch(/^Paid from money Example Immigration held for you in its client account\./);
    expect(view.rows).toContainEqual(["Reference", "CF-0002"]);
    expect(view.stillToPay).toBeNull();
    expect(view.invoiceHref).toBeNull();
  });

  it("renders the designed page with Download PDF, Print and See invoice, and a not-found state", () => {
    const view = receiptView({ receipt, receiptId: RECEIPT, organizationId: ORG, invoices: [invoice({})] });
    const html = renderToStaticMarkup(createElement(LivePortal, { page: "receipt", viewer, receipt: view }));
    expect(html).toContain("Receipt PR-0014");
    expect(html).toContain("Proof of what you paid Example Immigration.");
    expect(html).toContain('<div class="rcpt-amt">CAD 1,130.00</div>');
    expect(html).toContain(`href="/api/invoices/receipts/${RECEIPT}?organizationId=${ORG}"`);
    expect(html).toContain("Download PDF");
    expect(html).toContain(">Print</button>");
    expect(html).toContain("Still to pay");
    expect(html).toContain('href="/portal/payments"');
    const missing = renderToStaticMarkup(createElement(LivePortal, { page: "receipt", viewer, receipt: null }));
    expect(missing).toContain("Receipt not found");
  });
});
