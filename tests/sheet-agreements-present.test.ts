import { describe, expect, it } from "vitest";
import {
  agreementBadge,
  agreementFlags,
  agreementStaffError,
  agreementStepUpLocation,
  agreementsHref,
  DEFAULT_GOVERNMENT_FEE_NOTE,
  feeInputValue,
  needsStepUp,
  newAgreementHref,
  parseFeeMinor,
  readNewAgreement,
  readNewTemplate,
  sameTerms,
  signersFor,
  templateDefaults,
} from "@/modules/sheet/agreements-present";

const MATTER = "11111111-1111-4111-8111-111111111111";
const TEMPLATE = "22222222-2222-4222-8222-222222222222";

describe("Agreements page words", () => {
  it("labels each agreement state the Designer way, and a quote is never an agreement", () => {
    expect(agreementBadge("completed", "service")).toEqual({ tone: "ok", label: "Executed" });
    expect(agreementBadge("partially_signed", "service")).toEqual({ tone: "blue", label: "Partially signed" });
    expect(agreementBadge("sent", "service")).toEqual({ tone: "rev", label: "Sent" });
    expect(agreementBadge("sent", "quote")).toEqual({ tone: "gr", label: "Quote", detail: "not an agreement" });
    expect(agreementBadge("declined", "service")).toEqual({ tone: "bad", label: "Declined" });
    expect(agreementBadge("draft", "service")).toEqual({ tone: "gr", label: "Draft", detail: "not sent" });
  });

  it("tags rows for the filter chips", () => {
    expect(agreementFlags("sent", "service")).toEqual(["waiting"]);
    expect(agreementFlags("partially_signed", "consent")).toEqual(["waiting"]);
    expect(agreementFlags("completed", "service")).toEqual(["executed"]);
    expect(agreementFlags("expired", "quote")).toEqual(["quote", "closed"]);
    expect(agreementFlags("draft", "service")).toEqual([]);
  });

  it("checks the New agreement dialog before anything is sent", () => {
    expect(readNewAgreement({ matter: "", template: TEMPLATE, scope: "Prepare it" })).toEqual({ error: "Choose the matter." });
    expect(readNewAgreement({ matter: MATTER, template: "", scope: "Prepare it" })).toEqual({ error: "Choose an approved agreement template." });
    expect(readNewAgreement({ matter: MATTER, template: TEMPLATE, scope: " a " })).toEqual({ error: "Describe the services this agreement covers." });
    expect(readNewAgreement({ matter: MATTER, template: TEMPLATE, scope: "  Prepare   the PR application " })).toEqual({
      input: {
        matterId: MATTER,
        templateId: TEMPLATE,
        scope: "Prepare the PR application",
        exclusions: null,
        refundPolicy: null,
        feeCents: null,
        currency: "CAD",
        governmentFeeNote: null,
      },
    });
  });

  it("reads the agreement terms: fee in minor units, currency, and the notes with their line breaks", () => {
    const base = { matter: MATTER, template: TEMPLATE, scope: "Prepare the PR application" };
    expect(
      readNewAgreement({
        ...base,
        fee: " 1,500.5 ",
        currency: "usd",
        exclusions: "  Appeals\r\nJudicial review   \n\n\n\nTranslations ",
        refund: "Unearned advances are refunded.",
        government: DEFAULT_GOVERNMENT_FEE_NOTE,
      }),
    ).toEqual({
      input: {
        matterId: MATTER,
        templateId: TEMPLATE,
        scope: "Prepare the PR application",
        exclusions: "Appeals\nJudicial review\n\nTranslations",
        refundPolicy: "Unearned advances are refunded.",
        feeCents: 150050,
        currency: "USD",
        governmentFeeNote: DEFAULT_GOVERNMENT_FEE_NOTE,
      },
    });
    expect(readNewAgreement({ ...base, fee: "-5" })).toEqual({ error: "A professional fee can’t be negative." });
    expect(readNewAgreement({ ...base, fee: "1.234" })).toEqual({ error: "Enter the professional fee as an amount, like 1,500.00." });
    expect(readNewAgreement({ ...base, currency: "C$" })).toEqual({ error: "Choose the currency." });
    expect(readNewAgreement({ ...base, exclusions: "x".repeat(2001) })).toEqual({ error: "Keep what is not included to 2,000 characters." });
    expect(readNewAgreement({ ...base, refund: "x".repeat(2001) })).toEqual({ error: "Keep the refund policy to 2,000 characters." });
    expect(readNewAgreement({ ...base, government: "x".repeat(501) })).toEqual({ error: "Keep the government fees note to 500 characters." });
    // The scope is still required before any term is looked at.
    expect(readNewAgreement({ ...base, scope: "", fee: "100" })).toEqual({ error: "Describe the services this agreement covers." });
  });

  it("parses a professional fee without floating point", () => {
    expect(parseFeeMinor("")).toEqual({ cents: null });
    expect(parseFeeMinor("   ")).toEqual({ cents: null });
    expect(parseFeeMinor("0")).toEqual({ cents: 0 });
    expect(parseFeeMinor("1500")).toEqual({ cents: 150000 });
    expect(parseFeeMinor("$1,500.00")).toEqual({ cents: 150000 });
    expect(parseFeeMinor("CAD 1 500.1")).toEqual({ cents: 150010 });
    expect(parseFeeMinor("0.29")).toEqual({ cents: 29 });
    expect(parseFeeMinor(".5")).toEqual({ cents: 50 });
    expect(parseFeeMinor("1500.")).toEqual({ cents: 150000 });
    expect(parseFeeMinor("10000000")).toEqual({ cents: 1_000_000_000 });
    expect(parseFeeMinor("10000000.01")).toEqual({ error: "That professional fee is too large." });
    for (const bad of ["abc", "1.2.3", "1e5", ".", "12.345", "1,5O0"]) {
      expect(parseFeeMinor(bad)).toEqual({ error: "Enter the professional fee as an amount, like 1,500.00." });
    }
    expect(feeInputValue(150050)).toBe("1500.50");
    expect(feeInputValue("7")).toBe("0.07");
    expect(feeInputValue(null)).toBe("");
  });

  it("reuses an unsent draft only when every term is the same", () => {
    const terms = {
      scope: "Prepare it",
      exclusions: "Appeals",
      refundPolicy: null,
      feeCents: 150000,
      currency: "CAD",
      governmentFeeNote: DEFAULT_GOVERNMENT_FEE_NOTE,
    };
    const version = {
      scope_summary: "Prepare it",
      exclusions: "Appeals",
      refund_policy: null,
      fee_cents: 150000,
      currency: "CAD",
      government_fee_note: DEFAULT_GOVERNMENT_FEE_NOTE,
    };
    expect(sameTerms(version, terms)).toBe(true);
    expect(sameTerms({ ...version, fee_cents: "150000" }, terms)).toBe(true);
    expect(sameTerms(version, { ...terms, feeCents: 160000 })).toBe(false);
    expect(sameTerms(version, { ...terms, feeCents: null })).toBe(false);
    expect(sameTerms(version, { ...terms, currency: "USD" })).toBe(false);
    expect(sameTerms(version, { ...terms, exclusions: null })).toBe(false);
    expect(sameTerms(version, { ...terms, refundPolicy: "Refunds" })).toBe(false);
    expect(sameTerms(version, { ...terms, governmentFeeNote: null })).toBe(false);
    expect(sameTerms(version, { ...terms, scope: "Prepare more" })).toBe(false);
  });

  it("starts a template with its last agreement's terms, or a neutral government fees note with no amount", () => {
    const fresh = templateDefaults(null);
    expect(fresh).toEqual({ fee: "", currency: "CAD", exclusions: "", refund: "", government: DEFAULT_GOVERNMENT_FEE_NOTE });
    expect(DEFAULT_GOVERNMENT_FEE_NOTE).not.toMatch(/\d/);
    expect(
      templateDefaults({ exclusions: "Appeals", refund_policy: "Refunds", fee_cents: 250000, currency: "USD", government_fee_note: "Paid to IRCC." }),
    ).toEqual({ fee: "2500.00", currency: "USD", exclusions: "Appeals", refund: "Refunds", government: "Paid to IRCC." });
    // An older agreement made before the terms were captured still starts with the neutral note.
    expect(templateDefaults({ exclusions: null, refund_policy: null, fee_cents: null, currency: "CAD", government_fee_note: null }).government).toBe(
      DEFAULT_GOVERNMENT_FEE_NOTE,
    );
  });

  it("checks a new template and only offers kinds that are sent for signature", () => {
    expect(readNewTemplate({ kind: "quote", name: "Q", body: "x" })).toEqual({ error: "Choose what kind of agreement this is." });
    expect(readNewTemplate({ kind: "service", name: " ", body: "x" })).toEqual({ error: "Name the template." });
    expect(readNewTemplate({ kind: "service", name: "S-05", body: "  " })).toEqual({ error: "Add the agreement text." });
    expect(readNewTemplate({ kind: "consultation", name: " C-02 ", body: " Clause 1 " })).toEqual({
      input: { kind: "consultation", name: "C-02", body: "Clause 1" },
    });
  });

  it("asks the applicant to sign first, then the sponsor, and nobody without a name", () => {
    const names = new Map([
      ["p1", "Dana Lee"],
      ["p2", "Sam Lee"],
    ]);
    expect(
      signersFor(
        [
          { person_id: "p2", role: "sponsor" },
          { person_id: "p3", role: "dependant" },
          { person_id: "p1", role: "applicant" },
        ],
        names,
      ),
    ).toEqual([
      { role: "client", person_id: "p1", display_name: "Dana Lee" },
      { role: "sponsor", person_id: "p2", display_name: "Sam Lee" },
    ]);
    expect(signersFor([{ person_id: "p2", role: "sponsor" }], names)).toEqual([]);
    expect(signersFor([{ person_id: null, role: "applicant" }], names)).toEqual([]);
  });

  it("never passes a database message through, and spots a step-up refusal", () => {
    expect(agreementStaffError("this firm is in sample mode; only sample matters accept new work")).toMatch(/sample mode/);
    expect(agreementStaffError("raw internal detail")).toBe("That action could not be completed.");
    expect(needsStepUp(agreementStaffError("step-up is required"))).toBe(true);
    expect(needsStepUp(agreementStaffError("agreement denied"))).toBe(false);
  });

  it("comes back from step-up to the same dialog", () => {
    expect(agreementStepUpLocation("/sheet/agreements", "?q=CV-1", "agreement")).toBe(
      `/mfa?step=6&next=${encodeURIComponent("/sheet/agreements?q=CV-1&dlg=agreement")}`,
    );
    expect(agreementStepUpLocation("/sheet/agreements", "?dlg=template", null)).toBe(`/mfa?step=6&next=${encodeURIComponent("/sheet/agreements")}`);
  });

  it("links a matter to its agreements and to a New agreement for it", () => {
    expect(agreementsHref("CV-2026-0001")).toBe("/sheet/agreements?q=CV-2026-0001");
    expect(agreementsHref(null)).toBe("/sheet/agreements");
    expect(newAgreementHref(MATTER)).toBe(`/sheet/agreements?dlg=agreement&matter=${MATTER}`);
  });
});
