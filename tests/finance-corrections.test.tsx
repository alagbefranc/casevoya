import { PDFDocument } from "pdf-lib";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaymentsLive } from "@/components/portal/payments-live";
import {
  amountDue,
  canCredit,
  canVoid,
  correctionError,
  creditable,
  creditBalance,
  creditNoteState,
  monthLabel,
  parseBalance,
  readCreditNote,
  readReconciliation,
  readSign,
  reconciliationState,
  signedAmount,
} from "@/modules/finance/corrections-present";
import { CREDIT_NOTE_MONEY, creditNoteFilename, creditNoteFromRpc, creditNoteRows, renderCreditNotePdf } from "@/modules/finance/credit-note-pdf";
import { formatAmount } from "@/modules/finance/money";
import type { PortalInvoice, PortalInvoices } from "@/modules/finance/portal-load";
import { creditNoteHref } from "@/modules/finance/receipt-links";
import type { PortalViewer } from "@/modules/portal/load";
import { invoiceState } from "@/modules/sheet/finance-present";
import { pdfText } from "./helpers/pdf-text";

/** Credit notes, voids and reconciliation: the page arithmetic, input checks, wording and the PDF. Synthetic values only. */

const ORG = "11111111-1111-4111-8111-111111111111";
const INVOICE = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";

const money = (status: string, amount: number, paid: number, credited: number, refunded = 0) => ({ status, amountCents: amount, paidCents: paid, creditedCents: credited, refundedCents: refunded });

describe("invoice arithmetic", () => {
  it("takes credits off what is due, never below zero, and shows a credit balance only when money exceeds the invoice", () => {
    expect(amountDue(money("issued", 100_000, 0, 40_000))).toBe(60_000);
    expect(amountDue(money("partially_paid", 100_000, 30_000, 40_000))).toBe(30_000);
    expect(amountDue(money("paid", 100_000, 60_000, 40_000))).toBe(0);
    expect(amountDue(money("voided", 100_000, 0, 0))).toBe(0);
    expect(creditBalance(money("paid", 50_000, 50_000, 20_000))).toBe(20_000);
    // A refund already returned the extra: nothing more to refund.
    expect(creditBalance(money("paid", 50_000, 50_000, 20_000, 20_000))).toBe(0);
    expect(creditBalance(money("partially_paid", 100_000, 30_000, 40_000))).toBe(0);
    // A payment that arrived after a void is all to refund.
    expect(creditBalance(money("voided", 50_000, 50_000, 0))).toBe(50_000);
    expect(creditable(money("issued", 100_000, 0, 30_000), 20_000)).toBe(50_000);
    expect(creditable(money("issued", 100_000, 0, 100_000), 0)).toBe(0);
  });

  it("offers credit on issued invoices and a void only when nothing is allocated", () => {
    for (const status of ["issued", "partially_paid", "paid", "refunded"]) expect(canCredit(status)).toBe(true);
    for (const status of ["draft", "voided", "credited"]) expect(canCredit(status)).toBe(false);
    const none = { payments: 0, transfers: 0, receipts: 0, creditNotes: 0 };
    expect(canVoid(money("issued", 100, 0, 0), none)).toBe(true);
    expect(canVoid(money("partially_paid", 100, 10, 0), none)).toBe(false);
    expect(canVoid(money("issued", 100, 0, 0), { ...none, payments: 1 })).toBe(false);
    expect(canVoid(money("issued", 100, 0, 0), { ...none, transfers: 1 })).toBe(false);
    expect(canVoid(money("issued", 100, 0, 0), { ...none, receipts: 1 })).toBe(false);
    expect(canVoid(money("issued", 100, 0, 0), { ...none, creditNotes: 1 })).toBe(false);
  });

  it("says how much a partly credited invoice was credited, and that a voided or credited one is closed", () => {
    expect(invoiceState("issued", "2026-11-01", "2026-10-18", false, null, "CAD 40.00")).toMatchObject({ label: "Issued", detail: "CAD 40.00 credited", flag: "issued" });
    expect(invoiceState("paid", "2026-11-01", "2026-10-18", false, null, "CAD 40.00")).toMatchObject({ label: "Paid", detail: "CAD 40.00 credited" });
    expect(invoiceState("credited", "2026-11-01", "2026-10-18")).toMatchObject({ label: "Credited", flag: "closed" });
    expect(invoiceState("voided", "2026-11-01", "2026-10-18")).toMatchObject({ label: "Voided", flag: "closed" });
    expect(creditNoteState("issued", true)).toEqual({ tone: "ok", label: "Issued", detail: "by owner (own draft)" });
    expect(creditNoteState("draft")).toMatchObject({ label: "Draft", detail: "waiting for review" });
    expect(reconciliationState("exceptions").label).toBe("Signed with exceptions");
    expect(monthLabel("2026-10-16")).toBe("October 2026");
    expect(signedAmount(-1_200, (minor) => formatAmount(minor, "CAD"))).toBe("−12.00");
  });
});

describe("input checks", () => {
  it("reads a credit note: an invoice, a positive amount within what can be credited, and a reason", () => {
    expect(readCreditNote({ invoice: INVOICE, amount: "113.00", reason: "Service cancelled" }, 11_300)).toEqual({ input: { invoiceId: INVOICE, amountCents: 11_300, reason: "Service cancelled" } });
    expect(readCreditNote({ invoice: INVOICE, amount: "113.01", reason: "Service cancelled" }, 11_300)).toMatchObject({ error: expect.stringMatching(/more than can still be credited/) });
    expect(readCreditNote({ invoice: INVOICE, amount: "0", reason: "Service cancelled" }, null)).toMatchObject({ error: expect.stringMatching(/amount/) });
    expect(readCreditNote({ invoice: INVOICE, amount: "10", reason: "x" }, null)).toMatchObject({ error: expect.stringMatching(/reason/) });
    expect(readCreditNote({ invoice: "nope", amount: "10", reason: "Service cancelled" }, null)).toMatchObject({ error: "Choose the invoice." });
  });

  it("reads a statement balance, including zero and an overdrawn account", () => {
    expect(parseBalance("3,308.00")).toBe(330_800);
    expect(parseBalance("CAD 1 500")).toBe(150_000);
    expect(parseBalance("$12.5")).toBe(1_250);
    expect(parseBalance("0")).toBe(0);
    expect(parseBalance("0.00")).toBe(0);
    expect(parseBalance("-12.00")).toBe(-1_200);
    expect(parseBalance("(12.00)")).toBe(-1_200);
    expect(parseBalance("12.345")).toBeNull();
    expect(parseBalance("twelve")).toBeNull();
  });

  it("reads a reconciliation: an account, a statement date not in the future and after the last signed one", () => {
    const fields = { account: ACCOUNT, date: "2026-10-16", balance: "3,308.00", note: " Statement p.3 " };
    expect(readReconciliation(fields, "2026-10-18", "2026-09-30")).toEqual({ input: { accountId: ACCOUNT, statementDate: "2026-10-16", balanceCents: 330_800, note: "Statement p.3" } });
    expect(readReconciliation({ ...fields, date: "2026-10-19" }, "2026-10-18", null)).toMatchObject({ error: expect.stringMatching(/future/) });
    expect(readReconciliation(fields, "2026-10-18", "2026-10-16")).toMatchObject({ error: expect.stringMatching(/after the last signed/) });
    expect(readReconciliation({ ...fields, balance: "" }, "2026-10-18", null)).toMatchObject({ error: expect.stringMatching(/closing balance/) });
  });

  it("signs as reconciled only with no difference; exceptions need notes", () => {
    expect(readSign({ outcome: "reconciled", notes: "" }, 0)).toEqual({ input: { outcome: "reconciled", notes: null } });
    expect(readSign({ outcome: "reconciled", notes: "" }, 500)).toMatchObject({ error: expect.stringMatching(/difference must be zero/) });
    expect(readSign({ outcome: "exceptions", notes: "" }, 500)).toMatchObject({ error: "Explain the exceptions." });
    expect(readSign({ outcome: "exceptions", notes: "Deposit verified on 17 Oct" }, 500)).toEqual({ input: { outcome: "exceptions", notes: "Deposit verified on 17 Oct" } });
  });

  it("never passes a database message through", () => {
    expect(correctionError("the requester cannot issue their own credit note")).toMatch(/someone else issues it/);
    expect(correctionError("step-up is required: issuing your own credit note needs a step-up after the draft")).toMatch(/authenticator/);
    expect(correctionError("the preparer cannot sign their own reconciliation")).toMatch(/someone else signs it/);
    expect(correctionError("the ledger changed since this reconciliation was prepared; discard it and prepare it again")).toMatch(/Discard it and prepare it again/);
    expect(correctionError("only an issued invoice with nothing paid or credited can be voided")).toMatch(/credit note instead/);
    expect(correctionError("a reconciliation for this account is waiting for review")).toMatch(/already waiting for review/);
    expect(correctionError('relation "public.secret" does not exist')).toBe("That action could not be completed.");
  });
});

/** The invoice_credit_note RPC's JSON, synthetic values only. */
const NOTE = {
  number: "CN-0001",
  issued_at: "2026-10-18T18:05:07.000Z",
  amount_cents: 20_000,
  currency: "CAD",
  reason: "Remise accordée après révision",
  applied_cents: 5_000,
  credit_balance_cents: 15_000,
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
  is_sample: true,
};

describe("the credit note PDF", () => {
  it("checks the RPC's JSON and refuses anything incomplete or inconsistent", () => {
    expect(creditNoteFromRpc(NOTE)).toMatchObject({ number: "CN-0001", amountCents: 20_000, appliedCents: 5_000, creditBalanceCents: 15_000, isSample: true });
    expect(creditNoteFromRpc({ ...NOTE, reason: null })).toBeNull();
    expect(creditNoteFromRpc({ ...NOTE, applied_cents: 1 })).toBeNull();
    expect(creditNoteFromRpc(null)).toBeNull();
  });

  it("names the invoice, the reason and any credit owed back, and says it moves no money", async () => {
    const note = creditNoteFromRpc(NOTE)!;
    const rows = new Map(creditNoteRows(note));
    expect(rows.get("Against invoice")).toBe("INV-0001 — Préparation de la demande (issued 16 October 2026, total CAD 1,130.00)");
    expect(rows.get("Credit owed to the client")).toBe("CAD 150.00, refunded separately");
    expect(rows.get("Reduces amount due by")).toBe("CAD 50.00");
    expect(creditNoteFilename(note)).toBe("credit-note-cn-0001.pdf");
    const bytes = await renderCreditNotePdf(note);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toBe("Credit note CN-0001");
    const text = pdfText(bytes);
    for (const fragment of ["CREDIT NOTE", "CAD 200.00", "CN-0001", "Zoé Synthétique", "Remise accordée", "Fictional sample"]) expect(text).toContain(fragment);
    expect(text.replace(/\s+/g, " ")).toContain(CREDIT_NOTE_MONEY.split(":")[0]);
    // No rule is cited: the Code quoted in the repo says nothing about credit notes.
    expect(text).not.toMatch(/SOR\/2022-128|subsection|paragraph/);
  });
});

describe("the client's portal", () => {
  it("shows what is due after credits and a download for each issued credit note", () => {
    const viewer = { organizationId: ORG, organizationName: "Synthetic Firm", timezone: "America/Toronto", matters: [] } as unknown as PortalViewer;
    const invoice: PortalInvoice = {
      id: INVOICE,
      number: "INV-0001",
      description: "Preparation stage",
      matterTitle: "Work permit",
      amountCents: 100_000,
      paidCents: 0,
      refundedCents: 0,
      creditedCents: 40_000,
      currency: "CAD",
      status: "issued",
      issuedOn: "2026-10-16",
      dueOn: "2026-11-30",
      open: true,
      processing: false,
      state: { tone: "blue", label: "Issued", detail: "CAD 400.00 credited" },
      receipts: [],
      creditNotes: [{ id: "n1", number: "CN-0001", amountCents: 40_000 }],
    };
    const data: PortalInvoices = { invoices: [invoice], clientFunds: null, today: "2026-10-18", payable: true, publishableKey: "pk_test_x" };
    const html = renderToStaticMarkup(createElement(PaymentsLive, { viewer, data }));
    expect(html).toContain('<b class="num">CAD 600.00</b>');
    expect(html).toContain('<td class="num" style="text-align:right">CAD 600.00</td>');
    expect(html).toContain(`href="${creditNoteHref("n1", ORG).replaceAll("&", "&amp;")}"`);
    expect(html).toContain(">Credit note CN-0001</a>");
  });
});
