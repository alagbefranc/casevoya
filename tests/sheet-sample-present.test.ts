import { describe, expect, it } from "vitest";
import { licenceCheckWords, sampleSteps, trialDaysLeft } from "@/modules/sheet/sample-present";

describe("sample-mode page words", () => {
  it("lists the six steps in order, links them to the sample matter and marks recorded ones done", () => {
    const steps = sampleSteps("m-1", "Maple Immigration", "Priya", new Set(["intake", "upload"]));
    expect(steps.map((step) => step.key)).toEqual(["intake", "agreement", "upload", "reminder", "invoice", "export"]);
    expect(steps.map((step) => step.done)).toEqual([true, false, true, false, false, false]);
    expect(steps[0].href).toBe("/sheet/matters/m-1?tab=intake");
    expect(steps[4].note).toBe("From Maple Immigration to Priya");
  });

  it("describes the licence check and the trial clock", () => {
    expect(licenceCheckWords("declared")).toBe("waiting for review");
    expect(licenceCheckWords("verified")).toBe("passed");
    expect(licenceCheckWords("suspended")).toBe("needs attention");
    const now = new Date("2026-10-18T12:00:00Z");
    expect(trialDaysLeft("2026-11-01T12:00:00Z", now)).toBe(14);
    expect(trialDaysLeft("2026-10-01T00:00:00Z", now)).toBe(0);
    expect(trialDaysLeft(null, now)).toBeNull();
  });
});
