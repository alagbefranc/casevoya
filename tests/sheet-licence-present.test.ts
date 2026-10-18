import { describe, expect, it } from "vitest";
import {
  checkTargetLabel,
  dateTimeLabel,
  licenceCards,
  licenceDialogs,
  licenceLog,
  licenceTypeFor,
  LICENCE_REGULATORS,
  recheckMonths,
  type LicenceContext,
  type LicenceCredential,
  type LicenceMember,
} from "@/modules/sheet/licence-present";
import { suspendedData } from "@/modules/sheet/licence-suspended-present";

const NOW = new Date("2026-10-18T15:00:00Z");
const CONTEXT: LicenceContext = { timeZone: "America/Toronto", now: NOW, recheckMonths: 1, checkTarget: "1 business day", firmHasVerifiedLicence: false, viewerIsOwner: true };

const OWNER: LicenceMember = { membershipId: "m-owner", name: "Dana Lee", role: "firm_owner", status: "active", isSelf: true };
const CONSULTANT: LicenceMember = { membershipId: "m-cons", name: "Sam Park", role: "licensed_consultant", status: "active", isSelf: false };
const NEW_CONSULTANT: LicenceMember = { membershipId: "m-new", name: "Ray Ko", role: "licensed_consultant", status: "active", isSelf: false };
const CASE_MANAGER: LicenceMember = { membershipId: "m-cm", name: "Ida Moe", role: "case_manager", status: "active", isSelf: false };

function credential(overrides: Partial<LicenceCredential>): LicenceCredential {
  return {
    id: "c1",
    membershipId: "m-cons",
    licenceType: "RCIC",
    collegeId: "R1234567",
    scopeNote: null,
    status: "declared",
    proofLocator: null,
    sourceUrl: null,
    registerStatus: null,
    entitlement: null,
    restricted: false,
    restrictionDetail: null,
    declaredAt: "2026-10-15T20:12:00Z",
    checkedAt: null,
    nextReviewAt: null,
    validUntil: null,
    ...overrides,
  };
}

describe("Licences page", () => {
  it("shows a declared licence as waiting, says truthfully what is locked, and never invents proof", () => {
    const [, card] = licenceCards([OWNER, CONSULTANT], [credential({})], [], CONTEXT);
    expect(card.state).toEqual({ tone: "rev", label: "Waiting for check" });
    expect(card.rows.find((row) => row.label === "Until checked")?.value).toBe("Can work on files. Your firm can’t invite real clients until one licence is checked.");
    expect(card.proof).toEqual({ kind: "none", text: "No proof file yet. The reviewer keeps their own register evidence with the check." });
    expect(card.footer.note?.text).toBe("Usually checked within 1 business day");
    expect(card.source).toBeNull();
  });

  it("shows a verified licence with its register source, checked time, reviewer and next review", () => {
    const verified = credential({
      status: "verified",
      checkedAt: "2026-10-17T13:40:00Z",
      nextReviewAt: "2026-11-17T13:40:00Z",
      sourceUrl: "https://register.college-ic.ca/Public-Register-EN",
      registerStatus: "active",
      entitlement: true,
      proofLocator: "licence-proofs/x",
    });
    const log = [{ at: "2026-10-17T13:40:00Z", kind: "check", result: "verified", credentialId: "c1", holderName: "Sam Park", collegeId: "R1234567", actorName: "Mo Tran", actorIsPlatform: true }];
    const [, card] = licenceCards([OWNER, CONSULTANT], [verified], log, CONTEXT);
    expect(card.state.label).toBe("Verified");
    expect(card.source?.url).toBe("https://register.college-ic.ca/Public-Register-EN");
    expect(card.source?.checked).toBe("17 Oct 2026, 09:40");
    expect(card.source?.reviewer).toBe("Mo Tran, Casevoya verification");
    expect(card.rows.find((row) => row.label === "Last check")?.value).toEqual({ num: "17 Oct 2026, 09:40", suffix: " Toronto" });
    expect(card.rows.find((row) => row.label === "Next review")?.value).toEqual({ num: "17 Nov 2026", after: "monthly, or sooner if a change is reported" });
    expect(card.footer.report).toBe("c1");
  });

  it("marks an adverse result and what it pauses, and staff without a licence plainly", () => {
    const suspended = credential({ status: "suspended", checkedAt: "2026-10-17T13:40:00Z", sourceUrl: "https://register.college-ic.ca/x", registerStatus: "active", entitlement: true });
    const cards = licenceCards([OWNER, CASE_MANAGER, CONSULTANT, NEW_CONSULTANT], [suspended], [], CONTEXT);
    expect(cards.map((card) => card.name)).toEqual(["Dana Lee", "Sam Park", "Ray Ko", "Ida Moe"]);
    expect(cards[1].adverse).toBe(true);
    expect(cards[1].state).toEqual({ tone: "bad", label: "Suspended" });
    expect(cards[1].rows.find((row) => row.label === "Paused")).toBeTruthy();
    expect(cards[0].state.label).toBe("No licence on file");
    expect(cards[2].state).toEqual({ tone: "chg", label: "No licence on file" });
    expect(cards[3].state).toEqual({ tone: "gr", label: "No licence needed" });
  });

  it("lets only the owner or the holder report a change", () => {
    const verified = credential({ status: "verified", checkedAt: "2026-10-17T13:40:00Z", sourceUrl: "https://register.college-ic.ca/x" });
    const [, card] = licenceCards([OWNER, CONSULTANT], [verified], [], { ...CONTEXT, viewerIsOwner: false });
    expect(card.footer.report).toBeUndefined();
  });

  it("offers Add a licence for consultants without one, the owner themselves, and CICC only", () => {
    const owner = licenceDialogs([OWNER, CONSULTANT, NEW_CONSULTANT, CASE_MANAGER], [credential({})], true);
    expect(owner.consultants).toEqual([
      { label: "Dana Lee", membershipId: "m-owner" },
      { label: "Ray Ko", membershipId: "m-new" },
    ]);
    const consultant = licenceDialogs([{ ...OWNER, isSelf: false }, { ...NEW_CONSULTANT, isSelf: true }], [], false);
    expect(consultant.consultants).toEqual([{ label: "Ray Ko", membershipId: "m-new" }]);
    expect(licenceTypeFor(LICENCE_REGULATORS[1])).toBe("RISIA");
    expect(licenceTypeFor("Law society (lawyer or paralegal)")).toBeNull();
  });

  it("words the review log and the settings", () => {
    const log = licenceLog(
      [
        { at: "2026-10-17T13:40:00Z", kind: "check", result: "not_entitled", credentialId: "c1", holderName: "Sam Park", collegeId: "R1", actorName: "Dana Lee", actorIsPlatform: false },
        { at: "2026-10-15T20:12:00Z", kind: "declared", result: null, credentialId: "c1", holderName: "Sam Park", collegeId: "R1", actorName: "Sam Park", actorIsPlatform: false },
      ],
      "America/Toronto",
    );
    expect(log[0]).toEqual({ at: "17 Oct 2026, 09:40", title: { left: "Register checked", right: "not entitled to practise" }, parts: ["Sam Park", "R1", "by Dana Lee"] });
    expect(log[1]).toEqual({ at: "15 Oct 2026, 16:12", title: "Licence added", parts: ["R1", "by Sam Park"] });
    expect(recheckMonths({ unit: "months", count: 1 })).toBe(1);
    expect(recheckMonths({ unit: "days", count: 30 })).toBeNull();
    expect(checkTargetLabel({ unit: "business_days", count: 2 })).toBe("2 business days");
    expect(dateTimeLabel("2026-01-05T05:07:00Z", "America/Toronto")).toBe("5 Jan 2026, 00:07");
  });
});

describe("Licence-suspended home", () => {
  it("names the recorded result, ticks matters due within 30 days, and offers verified consultants only", () => {
    const data = suspendedData({
      organizationId: "org",
      membershipId: "m-cons",
      timeZone: "America/Toronto",
      now: NOW,
      credential: { status: "suspended", collegeId: "R1", checkedAt: "2026-10-15T14:00:00Z" },
      matters: [
        { id: "a", name: "Ana Diaz", reference: "CA-2026-0001", nextDeadline: { label: "Submission due", dueOn: "2026-10-24" } },
        { id: "b", name: "Ben Ito", reference: null, nextDeadline: { label: "Renewal", dueOn: "2027-01-10" } },
        { id: "c", name: "Cy Ode", reference: "CA-2026-0003", nextDeadline: null },
      ],
      targets: [{ membershipId: "m-x", name: "Lee Woo", licenceType: "RCIC", checkedAt: "2026-10-02T14:00:00Z" }],
    });
    expect(data.alert.title).toBe("Licence check on 15 Oct: suspended on the register");
    expect(data.footer.title).toBe("1 matter has deadlines in the next 30 days");
    expect(data.reassign.matters.map((matter) => matter.checked)).toEqual([true, false, false]);
    expect(data.reassign.matters[1].reference).toBe("no reference yet");
    expect(data.reassign.matters[2].note).toBe("No deadline recorded");
    expect(data.reassign.targets).toEqual([{ name: "Lee Woo", membershipId: "m-x", parts: ["RCIC", "verified 2 Oct"] }]);
    expect(data.stillWorks.join(" ")).not.toMatch(/Export/);
    expect(JSON.stringify(data)).not.toMatch(/emailed|notified/i);
  });
});
