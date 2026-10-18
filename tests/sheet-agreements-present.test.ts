import { describe, expect, it } from "vitest";
import {
  agreementBadge,
  agreementFlags,
  agreementStaffError,
  agreementStepUpLocation,
  agreementsHref,
  needsStepUp,
  newAgreementHref,
  readNewAgreement,
  readNewTemplate,
  signersFor,
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
      input: { matterId: MATTER, templateId: TEMPLATE, scope: "Prepare the PR application" },
    });
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
