import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { CreditDialog, EvidenceDialog, SheetFinanceRefunds, type RefundsData } from "@/components/sheet/designer/finance";
import {
  accountNeedsRefresh,
  advanceRefusal,
  connectAccountFromRow,
  connectCard,
  connectStage,
  isCardPayableCategory,
  liabilityText,
  requirementLine,
  type FinanceAccountData,
} from "@/modules/finance/connect-present";
import {
  allocationLine,
  creditAvailableCents,
  creditError,
  creditState,
  evidenceName,
  evidenceType,
  overpaidCents,
  readCredit,
} from "@/modules/finance/credits-present";
import { submitDisputeEvidence, type EvidenceDeps } from "@/modules/finance/dispute-evidence";
import { accountCreateParams, accountRequirements, accountResponsibilities, accountStatus, syncStatusArgs } from "@/modules/finance/stripe-account";

/** FIN-02 (Connect status card, earned-fee checkout) and FIN-13 (evidence, credits), with fakes only: no Stripe key. */

const ORG = "00000000-0000-4000-8000-000000000001";
const CREDIT = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
const DISPUTE = "33333333-3333-4333-8333-333333333333";

function account(overrides: Partial<Stripe.V2.Core.Account> = {}): Stripe.V2.Core.Account {
  return {
    id: "acct_1SyntheticFirm",
    object: "v2.core.account",
    livemode: false,
    configuration: { merchant: { capabilities: { card_payments: { status: "pending" }, stripe_balance: { payouts: { status: "pending" } } } } },
    requirements: {
      entries: [
        { description: "Provide the business’s tax ID", awaiting_action_from: "user", minimum_deadline: { status: "eventually_due" } },
        { description: "Verify the representative", awaiting_action_from: "user", minimum_deadline: { status: "past_due" } },
        { description: "  ", awaiting_action_from: "user", minimum_deadline: { status: "currently_due" } },
        { description: "Stripe is reviewing the account", awaiting_action_from: "stripe", minimum_deadline: { status: "currently_due" } },
      ],
    },
    defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
    ...overrides,
  } as unknown as Stripe.V2.Core.Account;
}

function finance(overrides: Partial<FinanceAccountData> = {}): FinanceAccountData {
  return { organizationId: ORG, firmName: "Synthetic Firm", isOwner: true, configured: true, publishableKey: "pk_test_synthetic", account: null, canBill: true, ...overrides };
}

describe("the connected account as Stripe reports it (FIN-02)", () => {
  it("keeps Stripe's own requirement wording, most urgent first, and its responsibilities", () => {
    expect(accountRequirements(account())).toEqual([
      { description: "Verify the representative", due: "past_due", from: "user" },
      { description: "Stripe is reviewing the account", due: "currently_due", from: "stripe" },
      { description: "Provide the business’s tax ID", due: "eventually_due", from: "user" },
    ]);
    expect(accountResponsibilities(account())).toEqual({ feesCollector: "stripe", lossesCollector: "stripe" });
    expect(accountResponsibilities(account({ defaults: { responsibilities: { fees_collector: "made_up" } } } as never))).toEqual({ feesCollector: null, lossesCollector: null });
    const status = accountStatus(account());
    expect(status).toMatchObject({ cardPayments: "pending", payouts: "pending", requirementsDue: 4, feesCollector: "stripe", lossesCollector: "stripe" });
    // The database call: unknown responsibilities are left out so the stored ones stay.
    expect(syncStatusArgs(ORG, "acct_1SyntheticFirm", { ...status, feesCollector: null, lossesCollector: null })).toEqual({
      p_org: ORG,
      p_account_id: "acct_1SyntheticFirm",
      p_card_payments_status: "pending",
      p_payouts_status: "pending",
      p_requirements: status.requirements,
    });
    // What Casevoya asks for at creation is the same configuration the card quotes before Stripe is read.
    expect(accountCreateParams({ organizationId: ORG, displayName: "Synthetic Firm", email: null }).defaults?.responsibilities).toEqual({ fees_collector: "stripe", losses_collector: "stripe" });
  });

  it("puts the account in one of four stages", () => {
    expect(connectStage(null)).toBe("not_connected");
    expect(connectStage({ cardPayments: "pending", payouts: "pending", requirementsDue: 2 })).toBe("onboarding");
    expect(connectStage({ cardPayments: "active", payouts: "pending", requirementsDue: 0 })).toBe("charges");
    expect(connectStage({ cardPayments: "active", payouts: "active", requirementsDue: 0 })).toBe("payouts");
    expect(connectStage({ cardPayments: "active", payouts: "active", requirementsDue: 1 })).toBe("charges");
  });

  it("builds the Settings card from the cached row, with Continue onboarding for the owner only", () => {
    const row = connectAccountFromRow({
      account_id: "acct_1SyntheticFirmLongId",
      card_payments_status: "pending",
      payouts_status: "pending",
      requirements_due: 2,
      requirements: [{ description: "Provide the business’s tax ID", due: "currently_due", from: "user" }, { description: "Stripe is reviewing", due: "eventually_due", from: "stripe" }, { nope: true }],
      fees_collector: "stripe",
      losses_collector: "stripe",
      status_checked_at: "2026-10-24T15:00:00Z",
    });
    const card = connectCard(finance({ account: row }), "America/Toronto");
    expect(card.badge).toEqual({ tone: "chg", label: "Onboarding incomplete" });
    expect(card.requirements).toEqual(["Provide the business’s tax ID (due now)", "Stripe is reviewing (Stripe is checking)"]);
    expect(card.rows.find(([term]) => term === "Stripe account")?.[1]).toBe("acct_1Syn…ngId (test mode)");
    expect(card.rows.find(([term]) => term === "Refunds and losses")?.[1]).toBe(
      "Stripe collects its processing fees from the firm’s own Stripe account (fees_collector “stripe”); Stripe covers a loss the firm’s Stripe balance can’t (an unpaid refund or a lost dispute) (losses_collector “stripe”). As Stripe reports it.",
    );
    expect(card.rows.find(([term]) => term === "Last checked with Stripe")?.[1]).toBe("24 Oct 2026, 11:00");
    expect(card.actions.map((action) => action.act)).toEqual(["continue", "refresh"]);
    expect(connectCard(finance({ account: row, isOwner: false }), "America/Toronto").actions).toEqual([]);

    const done = connectCard(finance({ account: { ...row, cardPayments: "active", payouts: "active", requirementsDue: 0, requirements: [] } }), "America/Toronto");
    expect(done.badge.label).toBe("Charges and payouts enabled");
    expect(done.actions.map((action) => action.act)).toEqual(["refresh"]);
    expect(done.rows.find(([term]) => term === "Stripe still needs")?.[1]).toBe("Nothing");

    const none = connectCard(finance(), "America/Toronto");
    expect(none.badge.label).toBe("Not connected");
    expect(none.actions.map((action) => action.act)).toEqual(["setup"]);
    expect(none.rows.find(([term]) => term === "Refunds and losses")?.[1]).toMatch(/^Casevoya asks Stripe for: .*losses_collector “stripe”/);

    expect(connectCard(finance({ canBill: false, isOwner: false }), "America/Toronto")).toMatchObject({ rows: [], actions: [], badge: { label: "Billing staff only" } });
    expect(connectCard(finance({ configured: false }), "America/Toronto").actions).toEqual([]);
  });

  it("never states a liability Stripe didn't report as Stripe's", () => {
    expect(liabilityText({ feesCollector: null, lossesCollector: null })).toMatch(/^Not read from Stripe yet\. Casevoya asked for:/);
    expect(liabilityText({ feesCollector: null, lossesCollector: "application" })).toBe(
      "Casevoya, the platform, covers a loss the firm’s Stripe balance can’t (an unpaid refund or a lost dispute) (losses_collector “application”). As Stripe reports it.",
    );
    expect(requirementLine({ description: "Add a bank account", due: "past_due", from: "user" })).toBe("Add a bank account (overdue)");
  });

  it("reads Stripe again for the owner when the account isn't finished, was never read, or is an hour old", () => {
    const now = new Date("2026-10-24T16:00:00Z");
    const base = { accountId: "acct_1SyntheticFirm", cardPayments: "active", payouts: "active", requirementsDue: 0, requirements: [], feesCollector: "stripe", lossesCollector: "stripe" };
    expect(accountNeedsRefresh({ ...base, checkedAt: "2026-10-24T15:30:00Z" }, now)).toBe(false);
    expect(accountNeedsRefresh({ ...base, checkedAt: "2026-10-24T14:30:00Z" }, now)).toBe(true);
    expect(accountNeedsRefresh({ ...base, checkedAt: null }, now)).toBe(true);
    expect(accountNeedsRefresh({ ...base, checkedAt: "2026-10-24T15:30:00Z", cardPayments: "pending" }, now)).toBe(true);
    expect(accountNeedsRefresh({ ...base, checkedAt: "2026-10-24T15:30:00Z", feesCollector: null, lossesCollector: null }, now)).toBe(true);
  });

  it("lets a client pay earned fees by card, never an advance", () => {
    expect(["professional_fee", "disbursement", "consultation_fee"].every(isCardPayableCategory)).toBe(true);
    expect(isCardPayableCategory("advance")).toBe(false);
    expect(isCardPayableCategory(null)).toBe(false);
    expect(advanceRefusal("Synthetic Firm").copy).toMatch(/client \(trust\) account.*earned fees only.*Nothing was charged\./);
  });
});

describe("client credits (FIN-13)", () => {
  it("counts the overpayment the way the database does, less card refunds pending at Stripe", () => {
    const paid = { status: "paid", amountCents: 100_000, paidCents: 105_000, refundedCents: 0, creditedCents: 0 };
    expect(overpaidCents(paid)).toBe(5_000);
    expect(creditAvailableCents(paid, 3_000)).toBe(2_000);
    expect(creditAvailableCents(paid, 9_000)).toBe(0);
    expect(overpaidCents({ ...paid, paidCents: 100_000, creditedCents: 20_000 })).toBe(20_000);
    expect(overpaidCents({ ...paid, status: "voided", paidCents: 40_000, refundedCents: 10_000 })).toBe(30_000);
    expect(overpaidCents({ ...paid, status: "draft" })).toBe(0);
    expect(overpaidCents({ ...paid, paidCents: 100_000, refundedCents: 10_000 })).toBe(0);
    expect(creditState("open", 2_000, 0).label).toBe("To refund or apply");
    expect(creditState("open", 0, 3_000).label).toBe("Refund processing");
    expect(creditState("settled", 0, 0).label).toBe("Settled");
  });

  it("describes each link", () => {
    expect(allocationLine({ kind: "invoice", amountCents: 5_000, currency: "CAD", invoiceNumber: "INV-0003" })).toBe("Applied to INV-0003, CAD 50.00");
    expect(allocationLine({ kind: "card_refund", amountCents: 3_000, currency: "CAD", refundNumber: "RF-0004", refundStatus: "pending" })).toBe("Card refund RF-0004, CAD 30.00, processing");
    expect(allocationLine({ kind: "bank_refund", amountCents: 2_000, currency: "CAD", method: "e_transfer", reference: "ET-1" })).toBe("Bank refund by e-Transfer ET-1, CAD 20.00");
  });

  it("checks the dialog before sending, and words the database's refusals", () => {
    const base = { credit: CREDIT, mode: "apply", amount: "50.00", target: TARGET, method: "e_transfer", reference: "ET-1", refundedOn: "2026-10-24" };
    expect(readCredit(base, 5_000, "2026-10-24")).toEqual({ input: { mode: "apply", creditId: CREDIT, amountCents: 5_000, targetInvoiceId: TARGET } });
    expect(readCredit({ ...base, amount: "50.01" }, 5_000, "2026-10-24")).toEqual({ error: "That’s more than is left on this credit." });
    expect(readCredit({ ...base, target: "" }, 5_000, "2026-10-24")).toEqual({ error: "Choose the invoice to apply it to." });
    expect(readCredit({ ...base, mode: "card" }, 5_000, "2026-10-24")).toEqual({ input: { mode: "card", creditId: CREDIT, amountCents: 5_000 } });
    expect(readCredit({ ...base, mode: "bank" }, 5_000, "2026-10-24")).toEqual({
      input: { mode: "bank", creditId: CREDIT, amountCents: 5_000, method: "e_transfer", reference: "ET-1", refundedOn: "2026-10-24" },
    });
    expect(readCredit({ ...base, mode: "bank", refundedOn: "2026-10-25" }, 5_000, "2026-10-24")).toEqual({ error: "The refund date can’t be in the future." });
    expect(readCredit({ ...base, mode: "bank", reference: " " }, 5_000, "2026-10-24")).toEqual({ error: "Enter the bank reference." });
    expect(readCredit({ ...base, mode: "x" }, 5_000, "2026-10-24")).toEqual({ error: "Choose what to do with the credit." });
    expect(creditError("a card refund of this invoice is still pending at Stripe")).toMatch(/isn’t refunded twice/);
    expect(creditError("a credit applies only to the same client's invoices")).toBe("A credit can only go to the same client’s invoices.");
  });

  it("renders the live Client credits panel and dialogs from the Designer's parts, and nothing extra without them", () => {
    const data: RefundsData = {
      intro: "Synthetic firm",
      refunds: [],
      refundsEmpty: { title: "x", copy: "x" },
      failed: null,
      creditNotes: [],
      creditNotesEmpty: { title: "x", copy: "x" },
      disputes: [{ number: "DP-0001", client: "Dana Lee", payment: ["Card", "INV-0001, fraudulent", "evidence sent 24 Oct"], amount: "1,130.00", evidenceDue: "2 Nov", state: { tone: "chg", label: "Evidence needed" } }],
      disputesEmpty: { title: "x", copy: "x" },
      disputeFooter: { evidenceLive: true, note: "Add evidence sends a file to Stripe." },
      credits: [
        {
          key: CREDIT,
          number: "CR-0001",
          client: "Dana Lee",
          from: { label: "INV-0001", href: `?tab=invoice&view=${TARGET}` },
          available: "20.00",
          links: ["Applied to INV-0003, CAD 30.00"],
          state: { tone: "chg", label: "To refund or apply" },
          act: { creditId: CREDIT, availableCents: 2_000, available: "20.00", label: "CR-0001 · Dana Lee · CAD 20.00 left", targets: [{ value: TARGET, label: "INV-0003 · CAD 10.00 owed", dueCents: 1_000 }], card: true, pendingCard: false },
        },
      ],
      creditsIntro: "Money held beyond what an invoice asks for.",
    };
    const html = renderToStaticMarkup(createElement(SheetFinanceRefunds, { data }));
    expect(html).toContain('<button class="btn p sm" data-dlg="dlgEvidence" data-fpb="1">Add evidence</button>');
    expect(html).toContain('<section class="panel rv" style="--i:4"><h2>');
    expect(html).toContain("Client credits");
    expect(html).toContain('<td>Applied to INV-0003, CAD 30.00</td>');
    expect(html).toContain('data-credit-open="11111111-1111-4111-8111-111111111111"');
    expect(html).toContain("evidence sent 24 Oct");
    const withoutCredits = renderToStaticMarkup(createElement(SheetFinanceRefunds, { data: { ...data, credits: undefined, disputeFooter: { note: "x" } } }));
    expect(withoutCredits).not.toContain("Client credits");
    expect(withoutCredits).not.toContain("Add evidence");

    const credit = renderToStaticMarkup(createElement(CreditDialog, { data: { organizationId: ORG, today: "2026-10-24", blocked: null } }));
    expect(credit).toContain('id="dlgCredit"');
    expect(credit).toContain('data-credit-submit="1"');
    expect(credit).toContain('max="2026-10-24"');
    const evidence = renderToStaticMarkup(createElement(EvidenceDialog, { data: { organizationId: ORG, disputes: [] } }));
    expect(evidence).toContain("No dispute waiting for evidence");
    expect(evidence).toMatch(/data-evidence-submit="1" data-org="[^"]+" disabled=""/);
  });
});

describe("dispute evidence (FIN-13)", () => {
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

  function fakes(overrides: Partial<EvidenceDeps> = {}) {
    const calls: string[] = [];
    const recorded: unknown[] = [];
    const deps: EvidenceDeps = {
      context: async () => {
        calls.push("context");
        return { data: { dispute_id: "du_1SyntheticDispute", account_id: "acct_1SyntheticFirm" }, error: null };
      },
      uploadFile: async ({ accountId, name, type }) => {
        calls.push(`upload:${accountId}:${name}:${type}`);
        return { id: "file_1SyntheticEvidence", livemode: false };
      },
      submit: async ({ accountId, disputeId, fileId, explanation }) => {
        calls.push(`submit:${accountId}:${disputeId}:${fileId}:${explanation}`);
        return { livemode: false };
      },
      record: async (args) => {
        calls.push("record");
        recorded.push(args);
        return { error: null };
      },
      ...overrides,
    };
    return { deps, calls, recorded };
  }

  it("checks the database first, then uploads and submits on the firm's account, then records it", async () => {
    const { deps, calls, recorded } = fakes();
    const result = await submitDisputeEvidence({ disputeId: DISPUTE, explanation: " Signed agreement ", fileName: "C:\\docs\\agreement.pdf", bytes: PDF }, deps);
    expect(result).toEqual({ ok: true, fileName: "agreement.pdf" });
    expect(calls).toEqual([
      "context",
      "upload:acct_1SyntheticFirm:agreement.pdf:application/pdf",
      "submit:acct_1SyntheticFirm:du_1SyntheticDispute:file_1SyntheticEvidence:Signed agreement",
      "record",
    ]);
    expect(recorded[0]).toMatchObject({ p_dispute_id: DISPUTE, p_stripe_file_id: "file_1SyntheticEvidence", p_submitted: true, p_livemode: false, p_size_bytes: PDF.byteLength });
  });

  it("refuses before Stripe when the file or the database says no", async () => {
    const wrongType = fakes();
    expect(await submitDisputeEvidence({ disputeId: DISPUTE, explanation: "", fileName: "a.exe", bytes: new Uint8Array([0x4d, 0x5a, 0, 0, 0]) }, wrongType.deps)).toEqual({ error: "Use a PDF, JPG or PNG file.", status: 415 });
    expect(wrongType.calls).toEqual([]);
    const stepUp = fakes({ context: async () => ({ data: null, error: "step-up is required" }) });
    const refused = await submitDisputeEvidence({ disputeId: DISPUTE, explanation: "", fileName: "a.pdf", bytes: PDF }, stepUp.deps);
    expect(refused).toMatchObject({ status: 403 });
    expect(stepUp.calls).toEqual([]);
    const closed = fakes({ context: async () => ({ data: null, error: "this dispute no longer takes evidence" }) });
    expect(await submitDisputeEvidence({ disputeId: DISPUTE, explanation: "", fileName: "a.pdf", bytes: PDF }, closed.deps)).toEqual({ error: "Stripe no longer takes evidence for this dispute.", status: 403 });
    expect(await submitDisputeEvidence({ disputeId: "nope", explanation: "", fileName: "a.pdf", bytes: PDF }, fakes().deps)).toMatchObject({ status: 400 });
  });

  it("records an uploaded file as not submitted when Stripe refuses the submission", async () => {
    const failing = fakes({
      submit: async () => {
        throw new Error("synthetic");
      },
    });
    const result = await submitDisputeEvidence({ disputeId: DISPUTE, explanation: "", fileName: "a.pdf", bytes: PDF }, failing.deps);
    expect(result).toMatchObject({ status: 502 });
    expect(failing.recorded[0]).toMatchObject({ p_submitted: false });
  });

  it("knows a file by its bytes and keeps a safe name", () => {
    expect(evidenceType(PDF)).toBe("application/pdf");
    expect(evidenceType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(evidenceType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(evidenceType(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]))).toBeNull();
    expect(evidenceName("../../etc/passwd\u0000", "application/pdf")).toBe("passwd");
    expect(evidenceName("", "image/png")).toBe("evidence.png");
  });
});
