import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FinanceBillingPanels, InvoiceBillingDialogs, MatterWork, MatterWorkDialogs } from "@/components/sheet/designer/billing-live";
import { IRCC_FEE_LIST_URL, parseIrccFeeList, readFeeAmount, readFeeListPage } from "@/modules/billing/ircc-fee-list";
import {
  ageingBucket,
  billingError,
  billingInvoiceState,
  durationLabel,
  invoiceAgeing,
  isOfficialFeeUrl,
  parseMinutes,
  parseRatePercent,
  readGovernmentFee,
  readTaxRate,
  readTimeEntry,
  readWriteOff,
  taxCents,
  timeAmountCents,
} from "@/modules/billing/present";
import { financeBilling, matterWork, taxChoices, taxState, timeState, unbilledTotals, type TimeEntryRow } from "@/modules/billing/view";
import { invoiceRows, type InvoicePdf } from "@/modules/finance/invoice-pdf";
import { invoiceState } from "@/modules/sheet/finance-present";

/** FIN-06 page arithmetic, input checks, wording and the live-only billing panels. Synthetic values only. */

const ORG = "00000000-0000-4000-8000-000000000001";
const MATTER = "00000000-0000-4000-8000-000000000002";
const ME = "00000000-0000-4000-8000-000000000003";
const OTHER = "00000000-0000-4000-8000-000000000004";
const TODAY = "2026-10-24";

function entry(id: string, patch: Partial<TimeEntryRow> = {}): TimeEntryRow {
  return { id, membership_id: ME, worked_on: "2026-10-20", minutes: 90, started_at: null, rate_cents: 15_000, description: "Synthetic preparation", billable: true, discarded_at: null, created_at: "2026-10-20T15:00:00Z", ...patch };
}

describe("time amounts and rounding", () => {
  it("90 minutes at $150/h is $225.00; half a cent rounds up", () => {
    expect(timeAmountCents(90, 15_000)).toBe(22_500);
    expect(timeAmountCents(7, 10_000)).toBe(1_167);
    expect(timeAmountCents(1, 30)).toBe(1);
    expect(timeAmountCents(1, 29)).toBe(0);
  });

  it("taxes at up to four decimals, rounding half away from zero", () => {
    expect(taxCents(22_500, 13)).toBe(2_925);
    expect(taxCents(10_000, 9.975)).toBe(998);
    expect(taxCents(1, 50)).toBe(1);
  });

  it("reads time as minutes or hours and minutes", () => {
    expect(parseMinutes("90")).toBe(90);
    expect(parseMinutes("1:30")).toBe(90);
    expect(parseMinutes("1.5h")).toBe(90);
    expect(parseMinutes("0")).toBeNull();
    expect(parseMinutes("25:00")).toBeNull();
    expect(durationLabel(90)).toBe("1 h 30 min");
    expect(durationLabel(45)).toBe("45 min");
    expect(durationLabel(120)).toBe("2 h");
  });

  it("checks a time entry: no future date, a rate, what it was for", () => {
    const base = { matter: MATTER, date: TODAY, minutes: "90", rate: "150.00", description: "Forms", billable: true };
    expect(readTimeEntry(base, TODAY)).toEqual({ input: { matterId: MATTER, workedOn: TODAY, minutes: 90, rateCents: 15_000, description: "Forms", billable: true } });
    expect(readTimeEntry({ ...base, date: "2026-10-25" }, TODAY)).toEqual({ error: "The date can’t be in the future." });
    expect(readTimeEntry({ ...base, rate: "abc" }, TODAY)).toHaveProperty("error");
    expect(readTimeEntry({ ...base, description: " " }, TODAY)).toHaveProperty("error");
    expect(readTimeEntry({ ...base, rate: "0" }, TODAY)).toMatchObject({ input: { rateCents: 0 } });
  });
});

describe("tax rates, write-offs and government fees", () => {
  it("reads a tax rate the firm chose", () => {
    expect(parseRatePercent("13")).toBe(13);
    expect(parseRatePercent("9.975%")).toBe(9.975);
    expect(parseRatePercent("9.97512")).toBeNull();
    expect(parseRatePercent("101")).toBeNull();
    const fields = { name: "HST Ontario", rate: "13", from: "2026-01-01", to: "", approvedBy: "Synthetic accountant", note: "" };
    expect(readTaxRate(fields)).toEqual({ input: { name: "HST Ontario", ratePercent: 13, from: "2026-01-01", to: null, approvedBy: "Synthetic accountant", note: null } });
    expect(readTaxRate({ ...fields, approvedBy: "" })).toHaveProperty("error");
    expect(readTaxRate({ ...fields, to: "2025-12-31" })).toHaveProperty("error");
  });

  it("states a rate and offers names in effect or upcoming", () => {
    const rates = [
      { id: "a", name: "HST Ontario", rate_percent: 13, effective_from: "2026-01-01", effective_to: null, approved_by: "x", source_note: null },
      { id: "b", name: "GST", rate_percent: "5.0000", effective_from: "2026-11-01", effective_to: null, approved_by: "x", source_note: null },
      { id: "c", name: "Old", rate_percent: 7, effective_from: "2020-01-01", effective_to: "2025-12-31", approved_by: "x", source_note: null },
    ];
    expect(rates.map((rate) => taxState(rate, TODAY).label)).toEqual(["In effect", "Upcoming", "Ended"]);
    expect(taxChoices(rates, TODAY)).toEqual([
      { value: "GST", label: "GST (not in effect today)" },
      { value: "HST Ontario", label: "HST Ontario (13% today)" },
    ]);
  });

  it("caps a write-off at what's owed and needs a reason", () => {
    expect(readWriteOff({ amount: "25", reason: "Goodwill" }, 22_500)).toEqual({ input: { amountCents: 2_500, reason: "Goodwill" } });
    expect(readWriteOff({ amount: "226", reason: "Goodwill" }, 22_500)).toEqual({ error: "That’s more than the CAD 225.00 still owed." });
    expect(readWriteOff({ amount: "25", reason: "x" }, null)).toHaveProperty("error");
  });

  it("takes a typed government fee only with an official https source and a checked date", () => {
    const fields = { reference: "", name: "Synthetic fee", amount: "150.00", url: `${IRCC_FEE_LIST_URL}#temporary`, checked: TODAY };
    expect(readGovernmentFee(fields, TODAY)).toEqual({ input: { referenceId: null, name: "Synthetic fee", amountCents: 15_000, url: `${IRCC_FEE_LIST_URL}#temporary`, checkedOn: TODAY } });
    expect(readGovernmentFee({ ...fields, url: "http://ircc.canada.ca/x" }, TODAY)).toHaveProperty("error");
    expect(readGovernmentFee({ ...fields, url: "https://canada.ca.example.com/x" }, TODAY)).toHaveProperty("error");
    expect(readGovernmentFee({ ...fields, checked: "2026-10-25" }, TODAY)).toHaveProperty("error");
    expect(readGovernmentFee({ ...fields, reference: "ref" }, TODAY)).toEqual({ input: { referenceId: "ref", name: null, amountCents: null, url: null, checkedOn: null } });
    expect(isOfficialFeeUrl("https://www.canada.ca/en/immigration-refugees-citizenship.html")).toBe(true);
  });

  it("says database refusals in the firm's words", () => {
    expect(billingError("no HST Ontario tax rate is in effect on 2026-10-24")).toMatch(/No tax rate of that name/);
    expect(billingError("that is more than the balance still owed")).toBe("That’s more than the balance still owed.");
    expect(billingError("step-up is required")).toMatch(/authenticator/);
    expect(billingError("something internal")).toBe("That action could not be completed.");
  });
});

describe("ageing", () => {
  it("buckets open invoices by days past due on the firm's today", () => {
    expect([TODAY, "2026-10-30", "2026-10-23", "2026-09-24", "2026-09-23", "2026-08-25", "2026-08-24", "2026-07-26", "2026-07-25"].map((due) => ageingBucket(due, TODAY))).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 4,
    ]);
    const row = (due: string, status = "issued", paid = 0) => ({ status, currency: "CAD", amount_cents: 22_500, paid_cents: paid, credited_cents: 2_500, due_on: due });
    const rows = invoiceAgeing([row(TODAY), row("2026-10-01", "partially_paid", 10_000), row("2026-01-01"), row(TODAY, "draft"), row(TODAY, "paid", 22_500)], TODAY);
    expect(rows.map((bucket) => [bucket.label, bucket.invoices, bucket.cents])).toEqual([
      ["Current", 1, 20_000],
      ["1–30 days", 1, 10_000],
      ["31–60 days", 0, 0],
      ["61–90 days", 0, 0],
      ["Over 90 days", 1, 20_000],
    ]);
  });
});

describe("invoice state with FIN-06", () => {
  it("names discarded drafts and write-offs", () => {
    const issued = invoiceState("issued", "2026-11-01", TODAY);
    expect(billingInvoiceState({ status: "draft", currency: "CAD", credited_cents: 0, discarded_at: "2026-10-24T10:00:00Z" }, invoiceState("draft", "2026-11-01", TODAY))).toMatchObject({ label: "Discarded draft", flag: "closed" });
    expect(billingInvoiceState({ status: "credited", currency: "CAD", credited_cents: 22_500, written_off_cents: 22_500 }, invoiceState("credited", "2026-11-01", TODAY)).label).toBe("Written off");
    expect(billingInvoiceState({ status: "issued", currency: "CAD", credited_cents: 2_500, written_off_cents: 2_500 }, issued)).toMatchObject({ label: "Issued", detail: "CAD 25.00 written off" });
    expect(billingInvoiceState({ status: "issued", currency: "CAD", credited_cents: 0, written_off_cents: 0 }, issued)).toBe(issued);
  });

  it("lists lines, tax and the written-off part on the invoice PDF", () => {
    const invoice: InvoicePdf = {
      number: "INV-0001",
      description: "Professional services: time recorded 2026-10-20",
      feeCategory: "professional_fee",
      status: "issued",
      amountCents: 25_425,
      paidCents: 0,
      creditedCents: 2_500,
      refundedCents: 0,
      currency: "CAD",
      issuedOn: TODAY,
      dueOn: "2026-11-23",
      createdAt: "2026-10-24T12:00:00Z",
      clientName: "Synthetic applicant",
      matterLabel: "Synthetic matter",
      firmLegalName: "Synthetic Legal Name",
      firmDisplayName: "Synthetic Firm",
      consultantName: null,
      consultantLicence: null,
      isSample: true,
      writtenOffCents: 2_500,
      lines: [{ category: "professional_fee", description: "2026-10-20: Forms", amountCents: 22_500, taxLabel: "HST Ontario 13%", taxCents: 2_925, source: null }],
    };
    const rows = new Map(invoiceRows(invoice));
    expect(rows.get("Line 1")).toBe("Professional fee · 2026-10-20: Forms · CAD 225.00 · HST Ontario 13% CAD 29.25");
    expect(rows.get("Tax")).toBe("CAD 29.25");
    expect(rows.get("Written off")).toBe("CAD 25.00");
    expect(rows.has("Credited")).toBe(false);
    expect(rows.get("Amount due")).toBe("CAD 229.25");
  });
});

describe("IRCC fee list", () => {
  // The page's structure (sections, groups, bold names, $CAN column), with synthetic fees.
  const HTML = `<html><body><main>
    <h2 id="temporary">Temporary Residence</h2>
    <details><summary><h3>Synthetic permits</h3></summary>
      <table><thead><tr class="active"><th scope="col">Fees</th><th scope="col">$CAN</th></tr></thead>
      <tbody>
        <tr><td><strong>Synthetic permit &ndash; per person</strong></td><td class="text-right">123.45</td></tr>
        <tr><td><p><strong>Synthetic visa - per person</strong></p><p class='small'>Note&nbsp;<sup><a href='#x'>What's this?</a></sup></p><section id='x'><h2 class='modal-title'>Popup</h2></section></td><td>1,050.00</td></tr>
        <tr><td><strong>Synthetic child fee</strong></td><td>270.00&nbsp;(per&nbsp;child)</td></tr>
        <tr><td><strong>Varies</strong></td><td>See guide</td></tr>
      </tbody></table></details>
    <h2 id="other">Other applications and services</h2>
    <details><summary><h3>Synthetic other</h3></summary><table><tbody><tr><td><strong>Synthetic replacement</strong></td><td>30.00</td></tr></tbody></table></details>
  </main></body></html>`;

  it("reads each fee with its section, group and anchor, and leaves out what isn't an amount", () => {
    expect(parseIrccFeeList(HTML)).toEqual([
      { section: "Temporary Residence", group: "Synthetic permits", name: "Synthetic permit – per person", amount_cents: 12_345, anchor: "temporary" },
      { section: "Temporary Residence", group: "Synthetic permits", name: "Synthetic visa - per person", amount_cents: 105_000, anchor: "temporary" },
      { section: "Temporary Residence", group: "Synthetic permits", name: "Synthetic child fee (per child)", amount_cents: 27_000, anchor: "temporary" },
      { section: "Other applications and services", group: "Synthetic other", name: "Synthetic replacement", amount_cents: 3_000, anchor: "other" },
    ]);
    expect(readFeeAmount("See guide")).toBeNull();
    expect(readFeeAmount("12.5")).toBeNull();
    expect(parseIrccFeeList("<main><p>Moved</p></main>")).toEqual([]);
  });

  it("fetches the page, hashes the bytes received and records nothing on failure", async () => {
    const ok = (async () => new Response(HTML, { status: 200 })) as unknown as typeof fetch;
    const read = await readFeeListPage(ok, () => new Date("2026-10-24T15:00:00Z"));
    expect(read).toMatchObject({ retrievedAt: "2026-10-24T15:00:00.000Z", sha256: createHash("sha256").update(HTML).digest("hex") });
    expect("rows" in read && read.rows).toHaveLength(4);
    const down = (async () => {
      throw new Error("blocked");
    }) as unknown as typeof fetch;
    expect(await readFeeListPage(down)).toHaveProperty("error");
    const missing = (async () => new Response("gone", { status: 404 })) as unknown as typeof fetch;
    expect(await readFeeListPage(missing)).toHaveProperty("error");
    const moved = (async () => new Response("<main><p>Moved</p></main>", { status: 200 })) as unknown as typeof fetch;
    expect(await readFeeListPage(moved)).toEqual({ error: "No fees could be read from IRCC’s page; its layout may have changed. Nothing was recorded." });
  });
});

describe("matter time and quotes", () => {
  const billed = new Map([["b", { number: "INV-0007", status: "issued" }], ["d", { number: "INV-0008", status: "draft" }]]);
  const entries = [entry("u"), entry("b"), entry("d"), entry("n", { billable: false }), entry("r", { minutes: null, started_at: "2026-10-24T14:05:00Z" }), entry("x", { discarded_at: "2026-10-21T00:00:00Z" })];

  it("states each entry and totals unbilled billable time", () => {
    expect(entries.map((row) => timeState(row, billed.get(row.id)).label)).toEqual(["Unbilled", "Billed on INV-0007", "On draft INV-0008", "Not billable", "Running", "Unbilled"]);
    expect(unbilledTotals(entries, billed)).toEqual({ minutes: 90, cents: 22_500, count: 1 });
  });

  it("builds the Billing tab's time and quote panels with the right buttons", () => {
    const data = matterWork({
      organizationId: ORG,
      matterId: MATTER,
      today: TODAY,
      timeZone: "America/Toronto",
      defaultDue: "2026-11-23",
      viewerMembershipId: ME,
      canLog: true,
      canBill: true,
      closed: false,
      entries: [...entries, entry("o", { membership_id: OTHER })],
      billed,
      names: new Map([[OTHER, "Synthetic colleague"]]),
      quotes: [
        { id: "q1", title: "Synthetic quote", totalCents: 105_000, instalments: [{ label: "On signing", amount_cents: 50_000, paid_as: "advance" }], invoiced: null, plan: null },
        {
          id: "q2",
          title: "Planned quote",
          totalCents: 105_000,
          instalments: [],
          invoiced: null,
          plan: {
            id: "p",
            status: "active",
            items: [
              { id: "i1", position: 1, label: "On signing", amount_cents: 50_000, paid_as: "advance", due_on: "2026-10-01", invoiced: null },
              { id: "i2", position: 2, label: "On submission", amount_cents: 55_000, paid_as: "invoice_after_delivery", due_on: "2026-11-30", invoiced: null },
            ],
          },
        },
      ],
      taxes: [],
    });
    expect(data.time.summary).toEqual(["3 h unbilled", "CAD 450.00"]);
    expect(data.time.running?.text).toBe("Synthetic preparation. Started at 10:05; stop it from its row.");
    expect(data.time.actions.map((action) => action.label)).toEqual(["Log time", "Draft invoice from unbilled time"]);
    expect(data.time.rows.find((row) => row.key === "o")?.who).toBe("Synthetic colleague");
    expect(data.time.rows.find((row) => row.key === "b")?.actions).toEqual([]);
    expect(data.quotes?.rows[0].actions.map((action) => action.label)).toEqual(["Draft invoice from quote", "Set up instalments"]);
    expect(data.quotes?.rows[1].plan?.rows.map((row) => [row.state.label, row.actions.map((action) => action.label)])).toEqual([
      ["Advance due", []],
      ["Not invoiced", ["Draft invoice"]],
    ]);
    expect(data.planDialogs).toHaveLength(1);
    const html = renderToStaticMarkup(createElement("div", null, createElement(MatterWork, { data }), createElement(MatterWorkDialogs, { data })));
    expect(html).toContain('data-billing-open="dlgTimeInv"');
    expect(html).toContain(`data-b-matter="${MATTER}"`);
    expect(html).toContain('data-billing-act="timer-stop"');
    expect(html).toContain('id="dlgPlan0"');
    expect(html).toContain("No tax rates yet");
  });

  it("shows a consultant time but no quotes or invoicing", () => {
    const data = matterWork({
      organizationId: ORG,
      matterId: MATTER,
      today: TODAY,
      timeZone: "America/Toronto",
      defaultDue: "2026-11-23",
      viewerMembershipId: ME,
      canLog: true,
      canBill: false,
      closed: false,
      entries: [entry("u")],
      billed: new Map(),
      names: new Map(),
      quotes: null,
      taxes: [],
    });
    expect(data.quotes).toBeNull();
    expect(data.time.actions.map((action) => action.label)).toEqual(["Log time"]);
  });
});

describe("Finance billing panels", () => {
  it("shows ageing, no invented rates, and the fee list gated by role", () => {
    const base = {
      organizationId: ORG,
      today: TODAY,
      defaultDue: "2026-11-23",
      timeZone: "America/Toronto",
      canBill: true,
      canManageRates: true,
      canFetchFees: true,
      canReviewFees: false,
      invoices: [{ status: "issued", currency: "CAD", amount_cents: 22_500, paid_cents: 0, credited_cents: 0, due_on: TODAY, is_sample: true }],
      sampleMode: true,
      unbilled: [{ matterId: MATTER, matter: "Synthetic applicant · ON-2026-0002", minutes: 90, cents: 22_500 }],
      rates: [],
      fees: [
        {
          id: "f",
          section: "Temporary Residence",
          fee_group: "Synthetic permits",
          name: "Synthetic permit",
          amount_cents: 12_345,
          source_url: `${IRCC_FEE_LIST_URL}#temporary`,
          retrieved_at: "2026-10-24T15:00:00Z",
          snapshot_sha256: "a".repeat(64),
          status: "pending_review",
        },
      ],
    };
    const data = financeBilling(base);
    expect(data.ageing.rows[0]).toEqual({ label: "Current", invoices: 1, amount: "225.00" });
    expect(data.taxes.rows).toEqual([]);
    expect(data.taxes.empty).toMatch(/never picks one/);
    expect(data.fees.actions.map((action) => action.label)).toEqual(["Read IRCC’s fee list now"]);
    expect(data.fees.rows[0].state.label).toBe("Waiting for review");
    expect(data.fees.source[0]).toBe(`Source ${IRCC_FEE_LIST_URL}`);
    expect(data.pending).toEqual({ sha256: "a".repeat(64), rows: 1 });
    expect(financeBilling({ ...base, canReviewFees: true }).fees.actions.map((action) => action.label)).toEqual(["Read IRCC’s fee list now", "Review"]);
    // Sample invoices are left out of real totals.
    expect(financeBilling({ ...base, sampleMode: false }).ageing.total.invoices).toBe(0);
    const html = renderToStaticMarkup(createElement(FinanceBillingPanels, { data }));
    expect(html).toContain('id="ageing"');
    expect(html).toContain("Unbilled time");
    expect(html).toContain('data-billing-act="fees-fetch"');
  });

  it("renders a draft's and an open invoice's dialogs", () => {
    const html = renderToStaticMarkup(
      createElement(InvoiceBillingDialogs, {
        data: { organizationId: ORG, invoiceId: MATTER, invoice: "INV-0001", today: TODAY, writeOff: { maxCents: 22_500, hint: "Up to CAD 225.00" }, draft: { references: [] } },
      }),
    );
    expect(html).toContain('id="dlgWO"');
    expect(html).toContain('data-max="22500"');
    expect(html).toContain('id="dlgGovFee"');
    expect(html).toContain("No approved references yet");
    expect(html).toContain('id="dlgDiscard"');
  });
});
