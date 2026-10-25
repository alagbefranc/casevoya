import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecordPaymentDialog } from "@/components/sheet/designer/funds";
import { BankAccountDialogs, ManualPaymentDialogs, ReconItemDialog, SettingsBankAccounts } from "@/components/sheet/designer/manual-pay";
import { SheetFinanceRecon, type ReconData } from "@/components/sheet/designer/recon";
import {
  MANUAL_METHODS,
  manualPaymentError,
  manualPaymentState,
  pendingManualCents,
  readAdvance,
  readManualPayment,
  readReconItem,
  readReverse,
  reviewersFor,
} from "@/modules/finance/manual-payments-present";
import { adjustedBalance, RECON_REPORT_NOTICE, reconciliationFilename, reconciliationRows, renderReconciliationPdf, type ReconReport } from "@/modules/finance/reconciliation-report";
import { reconciliationPdfHref } from "@/modules/finance/receipt-links";
import { invoiceState } from "@/modules/sheet/finance-present";
import { pdfText } from "./helpers/pdf-text";

/** Manual payments (FIN-09) and the reconciliation workspace (FIN-12): input checks, wording, the live parts and the PDF report. Synthetic values only. */

const ORG = "33333333-3333-4333-8333-333333333333";
const INVOICE = "44444444-4444-4444-8444-444444444444";
const ACCOUNT = "55555555-5555-4555-8555-555555555555";
const REVIEWER = "66666666-6666-4666-8666-666666666666";
const MATTER = "77777777-7777-4777-8777-777777777777";
const PERSON = "88888888-8888-4888-8888-888888888888";

const fields = { invoice: INVOICE, amount: "100.00", method: "interac_e_transfer", reference: "CA1xYz", received: "2026-10-20", account: ACCOUNT, note: "", reviewer: REVIEWER };

describe("recording a manual payment", () => {
  it("needs the amount, method, reference, date, destination, evidence (file or note) and reviewer", () => {
    expect(readManualPayment(fields, "2026-10-24", true, 50_000)).toEqual({
      input: { invoiceId: INVOICE, amountCents: 10_000, method: "interac_e_transfer", reference: "CA1xYz", receivedOn: "2026-10-20", accountId: ACCOUNT, note: null, reviewerId: REVIEWER },
    });
    expect(readManualPayment(fields, "2026-10-24", false, null)).toEqual({ error: expect.stringMatching(/Add the evidence/) });
    expect(readManualPayment({ ...fields, note: "Statement line 14 Oct" }, "2026-10-24", false, null)).toMatchObject({ input: { note: "Statement line 14 Oct" } });
    expect(readManualPayment({ ...fields, reference: " " }, "2026-10-24", true, null)).toEqual({ error: expect.stringMatching(/external reference/) });
    expect(readManualPayment({ ...fields, received: "2026-10-25" }, "2026-10-24", true, null)).toEqual({ error: expect.stringMatching(/future/) });
    expect(readManualPayment(fields, "2026-10-24", true, 9_999)).toEqual({ error: expect.stringMatching(/more than is due/) });
    expect(readManualPayment({ ...fields, method: "card" }, "2026-10-24", true, null)).toEqual({ error: "Choose how it was paid." });
    expect(readManualPayment({ ...fields, account: "" }, "2026-10-24", true, null)).toEqual({ error: expect.stringMatching(/firm account/) });
    expect(readManualPayment({ ...fields, reviewer: "" }, "2026-10-24", true, null)).toEqual({ error: "Choose who reviews it." });
  });

  it("offers e-transfer, cheque, wire and cash", () => {
    expect(MANUAL_METHODS.map((method) => method.label)).toEqual(["Wire or bank transfer", "Interac e-Transfer", "Cheque", "Cash (receipt required)"]);
  });

  it("asks the same of a client-funds advance", () => {
    const advance = { party: `${MATTER}:${PERSON}`, amount: "1808.00", method: "cheque", reference: "CHQ 104", received: "2026-10-20", account: ACCOUNT, evidence: "", reviewer: REVIEWER };
    expect(readAdvance(advance, "2026-10-24", true)).toMatchObject({ input: { matterId: MATTER, personId: PERSON, amountCents: 180_800, reference: "CHQ 104", note: null, reviewerId: REVIEWER } });
    expect(readAdvance(advance, "2026-10-24", false)).toEqual({ error: expect.stringMatching(/Add the evidence/) });
    expect(readAdvance({ ...advance, reference: "" }, "2026-10-24", true)).toEqual({ error: expect.stringMatching(/external reference/) });
    expect(readAdvance({ ...advance, reviewer: "x" }, "2026-10-24", true)).toEqual({ error: "Choose who reviews it." });
  });

  it("marks only a verified payment reversed; either may fail", () => {
    expect(readReverse({ outcome: "reversed", reason: "Recalled" }, true)).toEqual({ input: { outcome: "reversed", reason: "Recalled" } });
    expect(readReverse({ outcome: "reversed", reason: "Recalled" }, false)).toEqual({ error: expect.stringMatching(/Mark a pending one failed/) });
    expect(readReverse({ outcome: "failed", reason: "NSF" }, false)).toEqual({ input: { outcome: "failed", reason: "NSF" } });
    expect(readReverse({ outcome: "failed", reason: "x" }, false)).toEqual({ error: expect.stringMatching(/bank reported/) });
  });
});

describe("states", () => {
  it("says Pending verification on the invoice, never Paid, until it's verified", () => {
    expect(invoiceState("issued", "2026-11-01", "2026-10-24", false, null, null, "CAD 100.00")).toEqual({ tone: "rev", label: "Pending verification", detail: "CAD 100.00 recorded", flag: "issued" });
    // Even overdue, the pending payment is what the invoice says.
    expect(invoiceState("partially_paid", "2026-10-01", "2026-10-24", false, null, null, "CAD 100.00")).toMatchObject({ label: "Pending verification", flag: "partial" });
    expect(invoiceState("paid", "2026-10-01", "2026-10-24", false, null, null, null)).toMatchObject({ label: "Paid" });
    expect(invoiceState("issued", "2026-11-01", "2026-10-24")).toMatchObject({ label: "Issued" });
  });

  it("badges each manual payment and sums what's pending", () => {
    expect(manualPaymentState("pending_verification")).toEqual({ tone: "rev", label: "Pending verification" });
    expect(manualPaymentState("verified", true)).toEqual({ tone: "ok", label: "Verified", detail: "own entry" });
    expect(manualPaymentState("reversed")).toMatchObject({ tone: "bad", label: "Reversed" });
    expect(manualPaymentState("failed")).toMatchObject({ tone: "bad", label: "Failed" });
    expect(manualPaymentState("rejected")).toMatchObject({ label: "Rejected" });
    expect(
      pendingManualCents([
        { status: "pending_verification", amount_cents: 100 },
        { status: "verified", amount_cents: 50 },
        { status: "pending_verification", amount_cents: 25 },
      ]),
    ).toBe(125);
  });

  it("lists as reviewers the firm owners and the matter's finance users, the viewer only when alone", () => {
    const rows = [
      { user_id: "owner", display_name: "Olu Owner", role: "firm_owner", matter_ids: null },
      { user_id: "fin", display_name: "Fay Finance", role: "finance_user", matter_ids: [MATTER] },
      { user_id: "other", display_name: "Oz Other", role: "finance_user", matter_ids: [] },
    ];
    expect(reviewersFor(rows, MATTER, "fin")).toEqual([{ value: "owner", label: "Olu Owner (firm owner)" }]);
    expect(reviewersFor(rows, MATTER, "owner")).toEqual([{ value: "fin", label: "Fay Finance (finance)" }]);
    expect(reviewersFor([rows[0]], MATTER, "owner")).toEqual([{ value: "owner", label: "Olu Owner (firm owner) (you)" }]);
  });

  it("never passes a database message through", () => {
    expect(manualPaymentError("only the named reviewer or the firm owner can verify this payment")).toMatch(/reviewer named on this payment/);
    expect(manualPaymentError("payment exceeds the amount due on the invoice")).toMatch(/more than is due/);
    expect(manualPaymentError("that date is in a signed reconciliation period; record it with a later date")).toMatch(/already reconciled/);
    expect(manualPaymentError("firm owner step-up is required")).toMatch(/authenticator/);
    expect(manualPaymentError("relation public.secret does not exist")).toBe("That action could not be completed.");
  });
});

describe("outstanding reconciliation items", () => {
  it("are a deposit in transit or an outstanding cheque, dated on or before the statement", () => {
    const item = { kind: "outstanding_cheque", description: "Cheque 104 to the client", reference: "", date: "2026-10-30", amount: "400.00" };
    expect(readReconItem(item, "2026-10-31")).toEqual({ input: { kind: "outstanding_cheque", description: "Cheque 104 to the client", reference: null, itemDate: "2026-10-30", amountCents: 40_000 } });
    expect(readReconItem({ ...item, date: "2026-11-01" }, "2026-10-31")).toEqual({ error: expect.stringMatching(/on or before the statement date/) });
    expect(readReconItem({ ...item, kind: "fee" }, "2026-10-31")).toEqual({ error: expect.stringMatching(/deposit in transit/) });
    expect(readReconItem({ ...item, description: "x" }, "2026-10-31")).toEqual({ error: expect.stringMatching(/Describe/) });
  });
});

describe("live parts", () => {
  it("record, verify and reverse dialogs carry data attributes and the FIN-09 fields", () => {
    const html = renderToStaticMarkup(
      createElement(ManualPaymentDialogs, {
        data: {
          organizationId: ORG,
          today: "2026-10-24",
          invoiceId: INVOICE,
          invoice: "INV-0001",
          matterId: MATTER,
          maxCents: 50_000,
          hint: "CAD. Up to CAD 500.00",
          methods: MANUAL_METHODS,
          accounts: [{ value: ACCOUNT, label: "Operating ••• 1234 (operating)" }],
          reviewers: [{ value: REVIEWER, label: "Olu Owner (firm owner)" }],
          blocked: null,
        },
      }),
    );
    expect(html).not.toContain("data-toast");
    expect(html).toContain(`data-mp-record="1" data-org="${ORG}" data-invoice="${INVOICE}" data-matter="${MATTER}" data-today="2026-10-24" data-max="50000"`);
    for (const id of ["mxA", "mxM", "mxR", "mxD", "mxB", "mxE", "mxV"]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('data-mp-file="mxE"');
    expect(html).toContain(`<option value="${REVIEWER}">Olu Owner (firm owner)</option>`);
    expect(html).toContain(`data-mp-verify="1" data-org="${ORG}"`);
    expect(html).toContain(`data-mp-reject="1" data-org="${ORG}"`);
    expect(html).toContain(`data-mp-reverse="1" data-org="${ORG}"`);
    expect(html).toContain("The matter’s stage and government status don’t change.");
  });

  it("the advance dialog shows the upload and the reviewer when the page gives reviewers", () => {
    const html = renderToStaticMarkup(
      createElement(RecordPaymentDialog, {
        data: {
          live: {
            organizationId: ORG,
            today: "2026-10-24",
            sampleMode: false,
            parties: [{ value: `${MATTER}:${PERSON}`, label: "Dana Lee · ON-2026-0002" }],
            accounts: [{ value: ACCOUNT, label: "Client account ••• 4410 (advances)" }],
            reviewers: [{ value: REVIEWER, label: "Olu Owner (firm owner)", data: { "data-matters": "*" } }],
            blocked: null,
          },
        },
      }),
    );
    expect(html).toContain('data-mp-file="mpE"');
    expect(html).toContain('<select class="sel" id="mpV" aria-describedby="mpV-h" data-reviewers="1">');
    expect(html).toContain(`<option value="${REVIEWER}" data-matters="*">Olu Owner (firm owner)</option>`);
    expect(html).not.toContain("Files aren’t stored here yet");
  });

  it("the reconciliation item dialog and the bank account panel", () => {
    const item = renderToStaticMarkup(createElement(ReconItemDialog, { data: { organizationId: ORG, reconciliationId: INVOICE, statementDate: "2026-10-23" } }));
    expect(item).toContain(`data-rec-item="1" data-org="${ORG}" data-rec="${INVOICE}" data-statement="2026-10-23"`);
    expect(item).toContain('<input class="inp" id="riT" type="date" max="2026-10-23" aria-describedby="riT-h" value="2026-10-23"/>');
    const panel = renderToStaticMarkup(
      createElement(SettingsBankAccounts, {
        data: { organizationId: ORG, rows: [["Client (trust) account", "Client account: Synthetic Bank ••• 4410 · CAD"]], canAdd: true, note: "Records only." },
        index: 3,
      }),
    );
    expect(panel).toContain('<button class="btn sm" data-dlg="dlgBankC">Add the client account</button>');
    expect(panel).toContain("Client account: Synthetic Bank ••• 4410 · CAD");
    const dialogs = renderToStaticMarkup(createElement(BankAccountDialogs, { organizationId: ORG }));
    expect(dialogs).toContain(`data-bank-add="client" data-org="${ORG}"`);
    expect(dialogs).toContain(`data-bank-add="operating" data-org="${ORG}"`);
    expect(dialogs).toContain('<select class="sel" id="dlgBankCC" aria-describedby="dlgBankCC-h"><option value="CAD">CAD</option></select>');
  });

  it("the reconciliation tab shows the validation banner, a differing figure, the items' Add and a signed month's PDF", () => {
    const data: ReconData = {
      period: "October 2026",
      intro: "Three-way check.",
      banner: { title: "Not yet validated for production financial use", copy: "Your accountant and the practice reviewer must validate." },
      pending: {
        cards: [
          { title: "Adjusted bank balance", value: "CAD 600.00", note: "Statement", tone: "bad" },
          { title: "Control ledger", value: "CAD 1,000.00", note: "Ledger" },
          { title: "Client ledgers, total", value: "CAD 1,000.00", note: "1 client" },
        ],
        alert: { tone: "warn", title: ["CAD 400.00 difference", "0 outstanding items"], copy: "Add what's in transit.", action: null },
        items: [],
        itemsEmpty: "Nothing outstanding.",
        addItem: { label: "Add an outstanding deposit or cheque", attrs: { "data-dlg": "dlgRecItem" } },
        steps: [],
        sign: { label: "Sign reconciliation", disabled: false, why: null, attrs: { "data-dlg": "dlgRecSign" } },
      },
      start: null,
      history: [{ key: "r1", month: "September 2026", bank: "1,000.00", control: "1,000.00", clients: "1,000.00", signed: "Olu and Fay, 1 Oct", pdf: reconciliationPdfHref(INVOICE, ORG) }],
      historyEmpty: { title: "None", copy: "None" },
      payouts: null,
    };
    const html = renderToStaticMarkup(createElement(SheetFinanceRecon, { data }));
    expect(html).toContain("<b>Not yet validated for production financial use</b>Your accountant and the practice reviewer must validate.");
    expect(html).toContain('style="font-size:28px;display:block;color:var(--bad)">CAD 600.00</b>');
    expect(html).toContain('<button class="btn sm" data-dlg="dlgRecItem">Add an outstanding deposit or cheque</button>');
    expect(html).toContain(`<a href="/api/client-funds/reconciliations/${INVOICE}?organizationId=${ORG}" class="num" style="color:var(--blue)">PDF</a>`);
  });
});

describe("the reconciliation PDF report", () => {
  const report: ReconReport = {
    id: INVOICE,
    status: "reconciled",
    firmLegalName: "Synthetic Legal Name Inc.",
    firmDisplayName: "Synthetic Firm",
    firmTimezone: "America/Toronto",
    account: "Client account, Synthetic Bank ••• 4410, CAD",
    statementDate: "2026-10-23",
    periodStart: "2026-10-01",
    statementCents: 60_000,
    depositsInTransit: [{ label: "Branch deposit (DEP-9)", date: "2026-10-22", cents: 40_000 }],
    outstandingCheques: [],
    ledgerCents: 100_000,
    clientCents: 100_000,
    clientCount: 1,
    ledgerItems: [],
    preparedBy: "Fay Finance",
    preparedAt: "2026-10-24T14:00:00Z",
    preparerNote: null,
    signedBy: "Olu Owner",
    signedAt: "2026-10-24T15:00:00Z",
    ownerSelfSigned: false,
    reviewNotes: null,
    isSample: true,
  };

  it("adds deposits in transit and subtracts outstanding cheques; rows say who signed and when", () => {
    expect(adjustedBalance(report)).toBe(100_000);
    expect(adjustedBalance({ ...report, outstandingCheques: [{ label: "Cheque 12", date: "2026-10-20", cents: 5_000 }] })).toBe(95_000);
    const rows = new Map(reconciliationRows(report));
    expect(rows.get("Month")).toBe("October 2026");
    expect(rows.get("Adjusted bank balance")).toBe("CAD 1,000.00");
    expect(rows.get("Difference")).toMatch(/None/);
    expect(rows.get("Signed")).toMatch(/^Olu Owner, 24 October 2026, 11:00/);
    expect(reconciliationFilename(report)).toBe("reconciliation-2026-10-23.pdf");
    expect(reconciliationFilename({ ...report, status: "pending_review" })).toBe("reconciliation-2026-10-23-draft.pdf");
  });

  it("draws the report with the validation notice", async () => {
    const text = pdfText(await renderReconciliationPdf(report));
    expect(text).toContain("CLIENT ACCOUNT RECONCILIATION: ADJUSTED BANK BALANCE");
    expect(text).toContain("CAD 1,000.00");
    expect(text.replace(/\s+/g, " ")).toContain(RECON_REPORT_NOTICE.slice(0, 40));
    expect(text).toContain("Fictional sample. Not a client record.");
  });
});
