import { describe, expect, it } from "vitest";
import {
  agreementViewHref,
  amountInput,
  amountMajor,
  bpsToPercent,
  clauseSummary,
  compareSections,
  paidAsParts,
  percentToBps,
  quoteError,
  quoteTotals,
  readClauseEdit,
  readNewQuote,
  readQuoteConvert,
  readQuoteEdit,
  textParts,
  versionBadge,
  versionStateBadge,
} from "@/modules/sheet/agreements-views-present";

const AGREEMENT = "44444444-4444-4444-8444-444444444444";
const CLAUSE = "66666666-6666-4666-8666-666666666666";
const MATTER = "11111111-1111-4111-8111-111111111111";
const TEMPLATE = "22222222-2222-4222-8222-222222222222";

const FIELDS = { scope: "Prepare one PR application", services: "Eligibility review\nForms", exclusions: "", deliverables: "", feeStructure: "Milestones", refund: "", expiry: "2026-11-18", government: "" };
const LINE = { category: "professional_fee", description: "Milestone 1", amount: "1,600.00", taxRate: "", sourceNote: "" };

describe("Quote builder words and money", () => {
  it("shows cents as the Designer's money column and the dialog's field", () => {
    expect(amountMajor(160000)).toBe("1,600.00");
    expect(amountMajor("520000")).toBe("5,200.00");
    expect(amountMajor(null)).toBe("0.00");
    expect(amountInput(180800)).toBe("1808.00");
    expect(amountInput(5)).toBe("0.05");
  });

  it("totals the professional fee and the total to the firm, never the government fee", () => {
    const totals = quoteTotals([
      { category: "professional_fee", amount_cents: 160000 },
      { category: "professional_fee", amount_cents: "100000" },
      { category: "tax", amount_cents: 33800 },
      { category: "disbursement", amount_cents: 6200 },
      { category: "government_fee", amount_cents: 152500 },
    ]);
    expect(totals).toEqual({ feeCents: 260000, firmCents: 300000 });
  });

  it("splits typed text into the Designer's separated parts and reads percent rates", () => {
    expect(textParts("Eligibility review\ndocument checklist · forms")).toEqual(["Eligibility review", "document checklist", "forms"]);
    expect(textParts("", "Not listed")).toEqual(["Not listed"]);
    expect(paidAsParts("advance")).toEqual(["Advance", "client account"]);
    expect(paidAsParts("invoice_after_delivery")).toEqual(["Invoice after delivery"]);
    expect(bpsToPercent(1300)).toBe("13");
    expect(bpsToPercent(525)).toBe("5.25");
    expect(bpsToPercent(null)).toBe("");
    expect(percentToBps("13%")).toEqual({ bps: 1300 });
    expect(percentToBps("5.25")).toEqual({ bps: 525 });
    expect(percentToBps("")).toEqual({ bps: null });
    expect(percentToBps("abc")).toMatchObject({ error: expect.stringContaining("percent") });
  });

  it("opens each All agreements row in the right tab for its kind", () => {
    expect(agreementViewHref({ id: AGREEMENT, kind: "quote", status: "sent" }, false)).toBe(`/sheet/agreements?tab=quote&view=${AGREEMENT}`);
    expect(agreementViewHref({ id: AGREEMENT, kind: "service", status: "draft" }, false)).toBe(`/sheet/agreements?tab=editor&view=${AGREEMENT}`);
    expect(agreementViewHref({ id: AGREEMENT, kind: "service", status: "draft" }, true)).toBe(`/sheet/agreements?tab=envelope&view=${AGREEMENT}`);
    expect(agreementViewHref({ id: AGREEMENT, kind: "consultation", status: "sent" }, true)).toBe(`/sheet/agreements?tab=envelope&view=${AGREEMENT}`);
  });
});

describe("what the quote and clause dialogs send", () => {
  it("reads Edit quote into cents, requiring a reference for a government fee and matching instalments", () => {
    const read = readQuoteEdit(
      AGREEMENT,
      FIELDS,
      [LINE, { category: "tax", description: "HST", amount: "208.00", taxRate: "13", sourceNote: "" }],
      [
        { label: "On signing", amount: "1,000.00", paidAs: "advance" },
        { label: "Package released", amount: "808.00", paidAs: "invoice_after_delivery" },
      ],
    );
    if ("error" in read) throw new Error(read.error);
    expect(read.input).toMatchObject({
      agreementId: AGREEMENT,
      scope: "Prepare one PR application",
      services: "Eligibility review\nForms",
      exclusions: null,
      feeStructure: "Milestones",
      expiresOn: "2026-11-18",
      lines: [
        { category: "professional_fee", description: "Milestone 1", amount_cents: 160000, tax_rate_bps: null, source_note: null },
        { category: "tax", description: "HST", amount_cents: 20800, tax_rate_bps: 1300, source_note: null },
      ],
      instalments: [
        { label: "On signing", amount_cents: 100000, paid_as: "advance" },
        { label: "Package released", amount_cents: 80800, paid_as: "invoice_after_delivery" },
      ],
    });
    expect(readQuoteEdit(AGREEMENT, FIELDS, [{ ...LINE, category: "government_fee" }], [])).toMatchObject({ error: expect.stringContaining("official fee list") });
    expect(readQuoteEdit(AGREEMENT, FIELDS, [LINE], [{ label: "On signing", amount: "1.00", paidAs: "advance" }])).toMatchObject({ error: expect.stringContaining("Make them match") });
    expect(readQuoteEdit(AGREEMENT, { ...FIELDS, expiry: "soon" }, [LINE], [])).toMatchObject({ error: "Enter the date the quote expires." });
    expect(readQuoteEdit(AGREEMENT, { ...FIELDS, scope: "x" }, [LINE], [])).toMatchObject({ error: expect.stringContaining("scope") });
    expect(readQuoteEdit(AGREEMENT, FIELDS, [{ ...LINE, amount: "" }], [])).toMatchObject({ error: "Enter an amount for line 1, like 1,600.00." });
    expect(readQuoteEdit("nope", FIELDS, [LINE], [])).toMatchObject({ error: "Choose the quote to save." });
  });

  it("reads New quote, Turn into agreement and a clause edit", () => {
    expect(readNewQuote({ matter: MATTER, template: "", title: " PR, family class " })).toEqual({ input: { matterId: MATTER, templateId: null, title: "PR, family class" } });
    expect(readNewQuote({ matter: MATTER, template: TEMPLATE, title: "" })).toEqual({ input: { matterId: MATTER, templateId: TEMPLATE, title: null } });
    expect(readNewQuote({ matter: "", template: "" })).toMatchObject({ error: "Choose the client’s matter." });
    expect(readQuoteConvert({ agreementId: AGREEMENT, template: TEMPLATE })).toEqual({ input: { agreementId: AGREEMENT, templateId: TEMPLATE } });
    expect(readQuoteConvert({ agreementId: AGREEMENT, template: "" })).toMatchObject({ error: expect.stringContaining("approved service agreement template") });
    expect(readClauseEdit({ agreementId: AGREEMENT, clauseId: CLAUSE, body: "  New wording.\n\n\n\nMore.  " })).toEqual({ input: { agreementId: AGREEMENT, clauseId: CLAUSE, body: "New wording.\n\nMore." } });
    expect(readClauseEdit({ agreementId: AGREEMENT, clauseId: CLAUSE, body: " " })).toMatchObject({ error: "Add the clause’s wording." });
  });

  it("turns database refusals into plain words, never the raw message", () => {
    expect(quoteError("a government fee line needs a dated reference to the official fee list")).toContain("official fee list");
    expect(quoteError("an accepted quote cannot be edited; make a new quote")).toContain("accepted this quote");
    expect(quoteError("a mandatory clause is owned by the professional reviewer")).toContain("mandatory");
    expect(quoteError("an executed agreement cannot be edited; create an amendment")).toContain("executed");
    expect(quoteError("staff access denied")).toContain("licensed consultant or the firm owner");
    expect(quoteError("send the quote before turning it into an agreement")).toContain("Send the quote first");
    expect(quoteError("step-up is required")).not.toContain("step-up is required.");
  });
});

describe("Agreement editor and Compare versions words", () => {
  it("summarises a clause by its first line and badges each version", () => {
    expect(clauseSummary("\n\nPortal messages; replies within 2 business days.\nMore.")).toBe("Portal messages; replies within 2 business days.");
    expect(clauseSummary("x".repeat(200)).length).toBe(110);
    expect(clauseSummary("")).toBe("No wording yet");
    expect(versionBadge(1, "voided")).toEqual({ tone: "gr", label: "v1 voided" });
    expect(versionBadge(2, "sent")).toEqual({ tone: "rev", label: "v2 sent" });
    expect(versionBadge(3, "completed")).toEqual({ tone: "ok", label: "v3 executed" });
    expect(versionStateBadge("partially_signed")).toEqual({ tone: "blue", label: "Partially signed" });
    expect(versionStateBadge("superseded")).toEqual({ tone: "gr", label: "Replaced" });
  });

  it("diffs the two latest versions clause by clause, naming the sections that changed", () => {
    const badges = [versionBadge(1, "voided"), versionBadge(2, "sent")];
    const sections = compareSections(
      {
        clauses: [
          { position: 1, title: "Scope", body: "All of it." },
          { position: 5, title: "Fees", body: "Professional fee: CAD 2,600.00, plus HST.\n\nPaid as one invoice after submission." },
        ],
        body: null,
      },
      {
        clauses: [
          { position: 1, title: "Scope", body: "All of it." },
          { position: 5, title: "Fees", body: "Professional fee: CAD 2,900.00, plus HST.\n\nPaid as two milestones." },
          { position: 6, title: "Termination", body: "In writing." },
        ],
        body: null,
      },
      badges,
    );
    expect(sections.map((section) => [section.label, section.name])).toEqual([
      ["Section 5", "Fees"],
      ["Section 6", "Termination"],
    ]);
    expect(sections[0].paragraphs[0]).toEqual([
      { kind: "same", text: "Professional fee: CAD " },
      { kind: "del", text: "2,600.00," },
      { kind: "ins", text: "2,900.00," },
      { kind: "same", text: " plus HST." },
    ]);
    expect(sections[1].paragraphs).toEqual([[{ kind: "ins", text: "In writing." }]]);
    expect(sections[0].badges).toBe(badges);

    // Versions without clause rows compare as one whole text; identical ones say so.
    const whole = compareSections({ clauses: [], body: "Old text." }, { clauses: [], body: "New text." }, badges);
    expect(whole).toHaveLength(1);
    expect(whole[0].name).toBe("Agreement text");
    expect(whole[0].paragraphs[0].map((token) => token.kind)).toEqual(["del", "ins", "same"]);
    const same = compareSections({ clauses: [{ position: 1, title: "A", body: "x" }], body: null }, { clauses: [{ position: 1, title: "A", body: "x" }], body: null }, badges);
    expect(same[0].paragraphs).toEqual([]);
    expect(same[0].unchanged).toContain("same");
  });
});
