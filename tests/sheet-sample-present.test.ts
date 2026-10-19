import { describe, expect, it } from "vitest";
import { doneSteps, licenceCheckWords, sampleSteps, trialDaysLeft } from "@/modules/sheet/sample-present";

const NOTHING = { intakeSent: false, agreementSent: false, uploadReviewed: false, reminderScheduled: false, invoiceIssued: false, exportMade: false };

describe("sample-mode page words", () => {
  it("lists the six steps in order, links each Try it to a page that does it, and marks recorded ones done", () => {
    const steps = sampleSteps("m-1", "Maple Immigration", "Priya", new Set(["intake", "upload"]));
    expect(steps.map((step) => step.key)).toEqual(["intake", "agreement", "upload", "reminder", "invoice", "export"]);
    expect(steps.map((step) => step.done)).toEqual([true, false, true, false, false, false]);
    // Intake forms and Finance › New invoice, not unbuilt matter tabs.
    expect(steps[0].href).toBe("/sheet/intake-builder");
    expect(steps[2].href).toBe("/sheet/matters/m-1?tab=documents");
    expect(steps[4].href).toBe("/sheet/finance?dlg=invoice");
    expect(steps[4].note).toBe("From Maple Immigration to Priya");
  });

  it("marks a step done from what actually happened on the sample matter, keeping ones recorded by hand", () => {
    expect([...doneSteps(NOTHING, [])]).toEqual([]);
    expect([...doneSteps({ ...NOTHING, agreementSent: true, invoiceIssued: true }, ["export"])].sort()).toEqual(["agreement", "export", "invoice"]);
    const all = doneSteps({ intakeSent: true, agreementSent: true, uploadReviewed: true, reminderScheduled: true, invoiceIssued: true, exportMade: true }, []);
    expect([...all].sort()).toEqual(["agreement", "export", "intake", "invoice", "reminder", "upload"]);
  });

  it("describes the licence check in the one status set, and the trial clock", () => {
    expect(licenceCheckWords("declared")).toBe("declared");
    expect(licenceCheckWords("declared", "needs_review")).toBe("needs review");
    expect(licenceCheckWords("verified")).toBe("verified");
    expect(licenceCheckWords("suspended")).toBe("needs attention");
    const now = new Date("2026-10-18T12:00:00Z");
    expect(trialDaysLeft("2026-11-01T12:00:00Z", now)).toBe(14);
    expect(trialDaysLeft("2026-10-01T00:00:00Z", now)).toBe(0);
    expect(trialDaysLeft(null, now)).toBeNull();
  });
});
