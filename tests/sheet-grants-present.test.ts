import { describe, expect, it } from "vitest";
import { grantDialog, grantDraftProblem, grantRow, grantsData, readGrantDate, type FirmGrant } from "@/modules/sheet/grants-present";

const NOW = new Date("2026-10-18T15:00:00Z");
const ZONE = "America/Toronto";

const GRANT: FirmGrant = {
  id: "g1",
  kind: "explicit",
  granteeName: "Ben Ito",
  subjectName: "Ana Diaz",
  matterReference: "CA-2026-0001",
  purpose: "Cover while away",
  grantedByName: "Dana Lee",
  // Chosen day 28 Oct: ends at the next local midnight.
  expiresAt: "2026-10-29T04:00:00Z",
  revokedAt: null,
};

describe("Access grants page", () => {
  it("shows the chosen last day, read only, and the state", () => {
    expect(grantRow(GRANT, NOW, ZONE)).toEqual({
      who: "Ben Ito",
      canSee: { left: "CA-2026-0001", right: "Ana Diaz’s records, read only" },
      why: "Cover while away",
      grantedBy: "Dana Lee",
      expires: { num: "28 Oct 2026" },
      state: { tone: "ok", label: "Active" },
      // An active grant's row opens Revoke (#dlgGX).
      attrs: { "data-grant-row": "g1", "data-grant-label": "Ben Ito can see CA-2026-0001, Ana Diaz’s records, read only.", tabIndex: "0", title: "Revoke this grant" },
    });
    const expired = grantRow({ ...GRANT, expiresAt: "2026-10-01T04:00:00Z" }, NOW, ZONE);
    expect(expired).toMatchObject({ expires: "Expired 30 Sep", state: { tone: "gr", label: "Expired" } });
    expect(expired.attrs).toBeUndefined();
    const revoked = grantRow({ ...GRANT, revokedAt: "2026-10-17T15:00:00Z" }, NOW, ZONE);
    expect(revoked).toMatchObject({ expires: "Revoked 17 Oct", state: { label: "Revoked" } });
    expect(revoked.attrs).toBeUndefined();
    expect(grantRow({ ...GRANT, kind: "guardian", matterReference: null, expiresAt: null }, NOW, ZONE)).toMatchObject({
      canSee: { left: "Ana Diaz’s records", right: "as guardian" },
      expires: "While the child is a minor",
    });
  });

  it("counts active grants, claims no support access, and lists staff with firm-wide scope", () => {
    const data = grantsData("grants", [GRANT, { ...GRANT, revokedAt: "2026-10-17T15:00:00Z" }], [
      { name: "Dana Lee", role: "firm_owner", status: "active" },
      { name: "Lou Fin", role: "finance_user", status: "active" },
      { name: "Gone", role: "assistant", status: "suspended" },
    ], NOW, ZONE);
    expect(data.pills).toEqual(["1 active", "No support requests"]);
    expect(data.support).toEqual({ alert: null, request: null, history: [] });
    expect(data.limits).toEqual([
      { person: "Dana Lee", role: "Owner", office: "All offices", team: "All" },
      { person: "Lou Fin", role: "Finance", office: "All offices", team: { left: "Billing only", right: "no case narratives" } },
    ]);
  });

  it("offers people with a portal login and each person on an open matter", () => {
    const dialog = grantDialog("org", [
      { choice: "grantee", personId: "p1", personName: "Ben Ito", matterId: null, matterReference: null },
      { choice: "scope", personId: "p2", personName: "Ana Diaz", matterId: "m1", matterReference: null },
    ]);
    expect(dialog.people).toEqual([{ label: "Ben Ito", personId: "p1" }]);
    expect(dialog.scopes).toEqual([{ label: { left: "Matter without a reference", right: "Ana Diaz’s records, read only" }, matterId: "m1", subjectId: "p2" }]);
  });

  it("checks the New grant form before any step-up: end date from today to a year ahead, and a reason", () => {
    expect(grantDraftProblem("", "Cover", "2026-10-18")).toMatchObject({ field: "gE", title: "Enter an end date" });
    expect(grantDraftProblem("17/10/2026", "Cover", "2026-10-18")).toMatchObject({ field: "gE", title: "Choose another end date" });
    expect(grantDraftProblem("20/10/2027", "Cover", "2026-10-18")).toMatchObject({ field: "gE" });
    expect(grantDraftProblem("28/10/2026", "  ", "2026-10-18")).toMatchObject({ field: "gR", title: "Give a reason" });
    expect(grantDraftProblem("28/10/2026", "Cover while away", "2026-10-18")).toBeNull();
    expect(grantDraftProblem("18/10/2026", "Cover", "2026-10-18")).toBeNull();
    expect(grantDialog("org", [], "2026-10-18").today).toBe("2026-10-18");
  });

  it("says plainly that support access isn't offered, with no requirement code", () => {
    const data = grantsData("support", [], [], NOW, ZONE);
    expect(data.supportIntro).toContain("Support access isn’t offered");
    expect(data.supportIntro).not.toMatch(/SEC-09|built yet/);
  });

  it("reads DD/MM/YYYY and refuses dates that don't exist", () => {
    expect(readGrantDate("28/10/2026")).toBe("2026-10-28");
    expect(readGrantDate("2026-10-28")).toBe("2026-10-28");
    expect(readGrantDate("31/02/2026")).toBeNull();
    expect(readGrantDate("10/28/2026")).toBeNull();
    expect(readGrantDate("")).toBeNull();
  });
});
