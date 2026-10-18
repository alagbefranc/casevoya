import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaymentsLive } from "@/components/portal/payments-live";
import {
  bankStepText,
  clientFundsError,
  earliestWithdrawal,
  entryEffect,
  ledgerBadge,
  ledgerLines,
  ledgerTotals,
  readBankTransfer,
  readClientAccount,
  readDeposit,
  readRefundToClient,
  readTransfer,
  WITHDRAW_RULE,
  withdrawalState,
  withdrawalTiming,
  type FundEntry,
  type Withdrawal,
} from "@/modules/finance/client-funds-present";
import type { PortalInvoices } from "@/modules/finance/portal-load";
import type { PortalViewer } from "@/modules/portal/load";
import { dayMonth } from "@/modules/sheet/home-present";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

let n = 0;
function entry(partial: Partial<FundEntry>): FundEntry {
  n += 1;
  return {
    id: `e${n}`,
    number: `CF-${String(n).padStart(4, "0")}`,
    kind: "deposit",
    status: "verified",
    direction: "in",
    amountCents: 10_000,
    occurredOn: "2026-10-14",
    method: "bank_transfer",
    reference: "TD-1",
    evidence: null,
    note: null,
    invoiceNumber: null,
    reversesNumber: null,
    recordedBy: "Dana Lee",
    verifiedBy: "Sam Roe",
    approvedBy: null,
    ownerSelfApproved: false,
    ...partial,
  };
}

describe("client funds money", () => {
  it("counts only verified deposits, approved transfers, refunds and corrections", () => {
    expect(entryEffect(entry({ status: "pending_verification" }))).toBe(0);
    expect(entryEffect(entry({ status: "rejected" }))).toBe(0);
    expect(entryEffect(entry({}))).toBe(10_000);
    expect(entryEffect(entry({ kind: "transfer", status: "pending_approval", direction: "out" }))).toBe(0);
    expect(entryEffect(entry({ kind: "transfer", status: "declined", direction: "out" }))).toBe(0);
    expect(entryEffect(entry({ kind: "transfer", status: "approved", direction: "out" }))).toBe(-10_000);
    expect(entryEffect(entry({ kind: "refund", status: "recorded", direction: "out" }))).toBe(-10_000);
    expect(entryEffect(entry({ kind: "correction", status: "recorded", direction: "in" }))).toBe(10_000);

    const totals = ledgerTotals([
      entry({ amountCents: 150_000 }),
      entry({ status: "pending_verification", amountCents: 180_800 }),
      entry({ kind: "transfer", status: "pending_approval", direction: "out", amountCents: 30_000 }),
    ]);
    expect(totals).toEqual({ balanceCents: 150_000, pendingInCents: 180_800, pendingOutCents: 30_000, availableCents: 120_000 });
  });

  it("writes the Designer's ledger lines with a running balance", () => {
    const lines = ledgerLines(
      [
        entry({ amountCents: 100_000, occurredOn: "2026-10-03" }),
        entry({ amountCents: 50_000, occurredOn: "2026-10-14", reference: "TD-88213", verifiedBy: "Lena Park" }),
        entry({ kind: "transfer", status: "pending_approval", direction: "out", amountCents: 30_000, invoiceNumber: "INV-0001", note: "milestone 1" }),
        entry({ status: "pending_verification", amountCents: 180_800, reference: "RBC-55102", evidence: "screenshot" }),
      ],
      dayMonth,
    );
    expect(lines[1]).toMatchObject({ date: "14 Oct", entry: ["Advance deposit", "bank transfer"], evidence: ["TD-88213", "Lena"], in: "500.00", out: "", balance: "1,500.00" });
    expect(lines[2]).toMatchObject({ date: "—", entry: ["Proposed earned-fee transfer → INV-0001 milestone 1"], evidence: ["Needs approval"], out: "(300.00)", balance: "1,500.00" });
    expect(lines[3]).toMatchObject({ entry: ["Advance deposit", "bank transfer, recorded by hand"], evidence: ["RBC-55102", "screenshot"], in: "1,808.00", balance: "1,500.00 available" });

    const approved = ledgerLines([entry({ amountCents: 1_000 }), entry({ kind: "transfer", status: "approved", direction: "out", amountCents: 1_000, invoiceNumber: "INV-0002", ownerSelfApproved: true })], dayMonth);
    expect(approved[1]).toMatchObject({ evidence: ["Approved by owner (own request)"], out: "10.00", balance: "0.00" });
  });

  it("badges a ledger by what it waits on", () => {
    expect(ledgerBadge([entry({ status: "pending_verification" })])).toEqual({ tone: "rev", label: "Pending verification" });
    expect(ledgerBadge([entry({}), entry({ kind: "transfer", status: "pending_approval", direction: "out" })])).toEqual({ tone: "chg", label: "Approval needed" });
    expect(ledgerBadge([entry({})])).toEqual({ tone: "ok", label: "Verified" });
    expect(ledgerBadge([entry({ status: "rejected" })])).toEqual({ tone: "gr", label: "No balance" });
  });
});

describe("client funds inputs", () => {
  it("reads a deposit in integer cents and refuses what the database would", () => {
    const ok = readDeposit({ party: `${A}:${B}`, amount: "1,808.00", method: "bank_transfer", reference: " RBC-1 ", received: "2026-10-16", account: A, evidence: "" }, "2026-10-18");
    expect(ok).toEqual({ input: { matterId: A, personId: B, accountId: A, amountCents: 180_800, method: "bank_transfer", reference: "RBC-1", receivedOn: "2026-10-16", evidence: null } });
    expect(readDeposit({ party: "x", amount: "1", method: "cash", reference: "", received: "2026-10-16", account: A, evidence: "" }, "2026-10-18")).toHaveProperty("error");
    expect(readDeposit({ party: `${A}:${B}`, amount: "0.001", method: "cash", reference: "", received: "2026-10-16", account: A, evidence: "" }, "2026-10-18")).toHaveProperty("error");
    expect(readDeposit({ party: `${A}:${B}`, amount: "10", method: "crypto", reference: "", received: "2026-10-16", account: A, evidence: "" }, "2026-10-18")).toHaveProperty("error");
    expect(readDeposit({ party: `${A}:${B}`, amount: "10", method: "cash", reference: "", received: "2026-10-19", account: A, evidence: "" }, "2026-10-18")).toEqual({ error: "The received date can’t be in the future." });
  });

  it("caps transfers and refunds at what the page was told is available", () => {
    expect(readTransfer({ ledger: A, invoice: B, amount: "300", note: "" }, 30_000)).toEqual({ input: { ledgerId: A, invoiceId: B, amountCents: 30_000, note: null } });
    expect(readTransfer({ ledger: A, invoice: B, amount: "300.01", note: "" }, 30_000)).toHaveProperty("error");
    expect(readRefundToClient({ ledger: A, amount: "5", method: "cheque", reference: "", paid: "2026-10-18", reason: "ok" }, "2026-10-18", null)).toEqual({ error: "Give a short reason." });
    expect(readRefundToClient({ ledger: A, amount: "5", method: "cheque", reference: "", paid: "2026-10-18", reason: "Unused advance" }, "2026-10-18", 400)).toHaveProperty("error");
  });

  it("keeps only the last four digits of the client account", () => {
    expect(readClientAccount({ label: "Client account", institution: "Bank", last4: "4410" })).toHaveProperty("input");
    expect(readClientAccount({ label: "Client account", institution: "Bank", last4: "123456789" })).toHaveProperty("error");
  });

  it("turns database refusals into the firm's words, and keeps step-up refusals recognisable", () => {
    expect(clientFundsError("the requester cannot approve their own transfer")).toMatch(/someone else approves it/);
    expect(clientFundsError("transfer exceeds the client's available balance")).toMatch(/more than the client has available/);
    expect(clientFundsError("client balance cannot go negative")).toMatch(/more than the client has available/);
    expect(clientFundsError("the invoice must be on the same matter")).toMatch(/same matter/);
    expect(clientFundsError("step-up is required")).toBe(clientFundsError("step-up is required: approving your own request needs a step-up after the request"));
    expect(clientFundsError("step-up is required")).toBe(clientFundsError("step-up is required: verifying your own deposit needs a step-up after it was recorded"));
    expect(clientFundsError("some internal detail")).not.toMatch(/internal/);
  });
});

describe("the client's portal", () => {
  const viewer = { organizationId: A, organizationName: "Synthetic Firm", timezone: "America/Toronto", role: "client", person: null, matters: [], people: [], grants: [], shares: [], prefs: null, sections: [] } as unknown as PortalViewer;
  const base: PortalInvoices = { invoices: [], clientFunds: null, today: "2026-10-18", payable: false, publishableKey: null };

  it("shows nothing about a client account the client has no money in", () => {
    const html = renderToStaticMarkup(createElement(PaymentsLive, { viewer, data: base }));
    expect(html).not.toMatch(/client account/i);
    expect(html).toContain("Nothing to pay");
  });

  it("shows money held for the client and the entries that count, read-only", () => {
    const html = renderToStaticMarkup(
      createElement(PaymentsLive, {
        viewer,
        data: {
          ...base,
          clientFunds: {
            heldCents: 120_000,
            entries: [
              { id: "d", kind: "deposit", direction: "in", amountCents: 150_000, occurredOn: "2026-10-14", method: "bank_transfer", reference: "TD-1", invoiceNumber: null, matterTitle: "Work permit", receiptNumber: "RC-0001" },
              { id: "t", kind: "transfer", direction: "out", amountCents: 30_000, occurredOn: "2026-10-16", method: null, reference: null, invoiceNumber: "INV-0001", matterTitle: "Work permit", receiptNumber: null },
            ],
          },
        },
      }),
    );
    expect(html).toContain("Held for you in Synthetic Firm’s client account");
    expect(html).toContain("CAD 1,200.00");
    expect(html).toContain("Invoices and requests");
    expect(html).toContain('Advance payment <span class="sep" aria-hidden="true"></span> bank transfer');
    expect(html).toContain('INV-0001 <span class="sep" aria-hidden="true"></span> paid from your client account');
    expect(html).not.toMatch(/<button|data-funds/);
    // The advance's receipt (s. 32(b)): one download, on the deposit only, through the checked route.
    expect(html.match(/>Receipt<\/a>/g)).toHaveLength(1);
    expect(html).toContain(`<a class="btn sm" href="/api/client-funds/receipts/d?organizationId=${A}" aria-label="Download receipt RC-0001">Receipt</a>`);
  });
});

describe("client funds controls", () => {
  it("says who verified a deposit, including the owner's own entry, and links its receipt", () => {
    const lines = ledgerLines(
      [
        entry({ id: "own", verifiedBy: "Ana Owner", verifiedByOwnerSelf: true, receiptNumber: "RC-0001" }),
        entry({ id: "two", verifiedBy: "Sam Roe", receiptNumber: "RC-0002" }),
        entry({ id: "wait", status: "pending_verification", receiptNumber: null }),
      ],
      dayMonth,
      "CAD",
      (item) => `/r/${item.id}`,
    );
    expect(lines[0]).toMatchObject({ evidence: ["TD-1", "Verified by owner (own entry)"], receipt: { label: "Receipt RC-0001", href: "/r/own" } });
    expect(lines[1]).toMatchObject({ evidence: ["TD-1", "Sam"], receipt: { label: "Receipt RC-0002", href: "/r/two" } });
    expect(lines[2].receipt).toBeUndefined();
    // Without a link builder (the Designer's rows), no receipt link.
    expect(ledgerLines([entry({ receiptNumber: "RC-0003" })], dayMonth)[0].receipt).toBeUndefined();
  });

  it("shows an approved transfer as awaiting bank transfer until the bank transfer is recorded", () => {
    const approved = (bank: FundEntry["bank"]) =>
      ledgerLines([entry({ amountCents: 1_000 }), entry({ kind: "transfer", status: "approved", direction: "out", amountCents: 1_000, invoiceNumber: "INV-0002", approvedBy: "Sam Roe", bank })], dayMonth)[1];
    expect(approved(null).evidence).toEqual(["Approved by Sam Roe", "Approved — awaiting bank transfer"]);
    expect(approved({ on: "2026-10-20", reference: "BANK-77" }).evidence).toEqual(["Approved by Sam Roe", "Transferred 20 Oct", "BANK-77"]);
    expect(bankStepText({ bank: null }, dayMonth)).toEqual(["Approved — awaiting bank transfer"]);
  });

  it("badges a ledger with its s. 32(g) withdrawal date, overdue first", () => {
    const rows: Withdrawal[] = [
      { state: "awaiting_bank_transfer", matterId: A, ledgerId: B, entryId: A, invoiceNumber: "INV-0002", amountCents: 100, withdrawBy: "2026-11-17", daysLeft: 30, overdue: false },
      { state: "not_requested", matterId: A, ledgerId: null, entryId: null, invoiceNumber: "INV-0001", amountCents: 100, withdrawBy: "2026-11-02", daysLeft: 15, overdue: false },
    ];
    const due = earliestWithdrawal(rows, dayMonth);
    expect(due).toEqual({ by: "2026-11-02", label: "2 Nov", overdue: false });
    expect(earliestWithdrawal([], dayMonth)).toBeNull();
    expect(ledgerBadge([entry({})], due)).toEqual({ tone: "chg", label: "Withdraw by 2 Nov" });
    expect(ledgerBadge([entry({ status: "pending_verification" })], due)).toEqual({ tone: "rev", label: "Pending verification" });
    const late = earliestWithdrawal([{ ...rows[1], daysLeft: -1, overdue: true }], dayMonth);
    expect(ledgerBadge([entry({ status: "pending_verification" })], late)).toEqual({ tone: "bad", label: "Withdraw by 2 Nov", detail: "overdue" });
    expect(withdrawalTiming({ daysLeft: 3, overdue: false })).toBe("Due in 3 days");
    expect(withdrawalTiming({ daysLeft: 1, overdue: false })).toBe("Due in 1 day");
    expect(withdrawalTiming({ daysLeft: 0, overdue: false })).toBe("Due today");
    expect(withdrawalTiming({ daysLeft: -2, overdue: true })).toBe("2 days overdue");
    expect(withdrawalState({ state: "awaiting_bank_transfer" })).toBe("approved — awaiting bank transfer");
    expect(WITHDRAW_RULE).toMatch(/32\(g\).*30 days after the day the client is invoiced/);
  });

  it("reads a bank transfer: required reference, not in the future, not before the invoice", () => {
    const fields = { entry: A, transferred: "2026-10-18", reference: " BANK-1 ", note: "" };
    expect(readBankTransfer(fields, "2026-10-18", "2026-10-01")).toEqual({ input: { entryId: A, transferredOn: "2026-10-18", reference: "BANK-1", note: null } });
    expect(readBankTransfer({ ...fields, reference: "  " }, "2026-10-18", null)).toEqual({ error: "Enter the bank’s reference for the transfer." });
    expect(readBankTransfer({ ...fields, transferred: "2026-10-19" }, "2026-10-18", null)).toEqual({ error: "The date can’t be in the future." });
    expect(readBankTransfer({ ...fields, transferred: "2026-09-30" }, "2026-10-18", "2026-10-01")).toEqual({ error: "The bank transfer can’t be before the invoice date." });
    expect(readBankTransfer({ ...fields, entry: "x" }, "2026-10-18", null)).toHaveProperty("error");
  });

  it("words the new refusals", () => {
    expect(clientFundsError("the person who recorded a deposit cannot verify it")).toMatch(/someone else verifies it.*firm owner may verify their own/);
    expect(clientFundsError("the bank transfer was already recorded")).toMatch(/already recorded/);
    expect(clientFundsError("the bank transfer can't be dated before the invoice (CICC Code s. 32(f))")).toMatch(/before the invoice date/);
    expect(clientFundsError("only an approved transfer has a bank transfer to record")).toMatch(/Only an approved transfer/);
  });
});
