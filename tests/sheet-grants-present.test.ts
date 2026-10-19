import { describe, expect, it } from "vitest";
import {
  grantDialog,
  grantDraftProblem,
  grantRow,
  grantsData,
  readGrantDate,
  readSupportAccess,
  supportData,
  supportOpened,
  supportPill,
  supportScopeLabel,
  type FirmGrant,
  type FirmSupportAccess,
} from "@/modules/sheet/grants-present";

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

  it("counts active grants, says no support request is waiting, and lists staff with firm-wide scope", () => {
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

  it("says plainly how support access works, with no requirement code", () => {
    const data = grantsData("support", [], [], NOW, ZONE);
    expect(data.supportIntro).toContain("unless you approve a request");
    expect(data.supportIntro).toContain("60 minutes by default");
    expect(data.supportIntro).not.toMatch(/SEC-09|built yet|isn’t offered/);
  });

  const SUPPORT: FirmSupportAccess = {
    alert: {
      id: "r1",
      requester_name: "Jordan Reid",
      ticket_ref: "CS-2291",
      scope: "matter_documents",
      matter_reference: "NL-2026-0131",
      matter_title: "Kofi Mensah",
      reason: "Upload keeps failing for Kofi",
      approved_by_name: "Amara Osei",
      approved_at: "2026-10-18T13:04:00Z",
      starts_at: "2026-10-18T13:04:00Z",
      ends_at: "2026-10-18T15:08:00Z",
      extension_count: 0,
      uses: 1,
    },
    request: {
      id: "r2",
      requester_name: "Jordan Reid",
      requester_email: "jordan@example.test",
      ticket_ref: "CS-2291",
      scope: "matter_documents",
      matter_reference: "NL-2026-0131",
      matter_title: "Kofi Mensah",
      not_included: null,
      reason: "uploads time out over 20 MB",
      requested_minutes: 45,
      created_at: "2026-10-18T14:00:00Z",
    },
    pending: 1,
    history: [
      { id: "h1", status: "ended", requester_name: "Jordan Reid", scope: "matter_documents", matter_reference: "NL-2026-0131", approved_by_name: "Amara Osei", created_at: "2026-10-17T12:50:00Z", starts_at: "2026-10-17T13:04:00Z", ends_at: "2026-10-17T14:04:00Z", ended_at: null, decline_reason: null, uses: 2 },
      { id: "h2", status: "declined", requester_name: "Jordan Reid", scope: "firm_settings", matter_reference: null, approved_by_name: null, created_at: "2026-10-02T19:10:00Z", starts_at: null, ends_at: null, ended_at: null, decline_reason: "Not now", uses: 0 },
    ],
  };

  it("fills the Support access tab from firm_support_access in the Designer's words, wired by data attributes", () => {
    const data = grantsData("support", [], [], NOW, ZONE, SUPPORT, "org-1");
    expect(data.pills).toEqual(["0 active", "1 support request"]);
    expect(data.support.alert).toEqual({
      title: "Support grant ends in 8 minutes",
      parts: ["Casevoya support (Jordan Reid)", "NL-2026-0131 documents only", "approved by Amara Osei at 09:04", "reason: “Upload keeps failing for Kofi”."],
      wire: { "data-support-id": "r1", "data-org": "org-1" },
    });
    expect(data.support.request).toEqual({
      from: "Jordan Reid, Casevoya platform support",
      scope: "Document records for NL-2026-0131",
      notIncluded: "Document contents, messages, finance, other matters",
      duration: "45 minutes from approval",
      reason: { left: "Ticket CS-2291", right: "uploads time out over 20 MB" },
      approveLabel: "Approve for 45 minutes",
      wire: { "data-support-id": "r2", "data-org": "org-1" },
    });
    expect(data.support.history).toEqual([
      { when: "17 Oct 09:04–10:04", who: "Jordan Reid", scope: "NL-2026-0131 documents", approvedBy: "Amara Osei", opened: "2 records, both listed in Audit" },
      { when: "2 Oct 15:10", who: "Jordan Reid", scope: "Firm settings only", approvedBy: "Declined", opened: "Nothing" },
    ]);
    // Without an organization (not the owner) nothing is wired; without an answer, nothing is shown.
    expect(supportData(SUPPORT, NOW, ZONE).alert?.wire).toBeUndefined();
    expect(supportData(null, NOW, ZONE)).toEqual({ alert: null, request: null, history: [] });
    expect(supportData({ ...SUPPORT, alert: { ...SUPPORT.alert!, ends_at: "2026-10-18T15:00:30Z", approved_by_name: null } }, NOW, ZONE).alert?.title).toBe("Support grant ends in 1 minute");
    expect(supportData({ ...SUPPORT, alert: { ...SUPPORT.alert!, approved_by_name: null } }, NOW, ZONE).alert?.parts[2]).toBe("approved by a firm owner at 09:04");
  });

  it("names scopes, counts what support opened, and counts waiting requests", () => {
    expect(supportScopeLabel("matter_all", "NL-1", null, "alert")).toBe("NL-1, all records");
    expect(supportScopeLabel("matter_records", null, "Kofi Mensah", "request")).toBe("Parties, tasks and deadlines for Kofi Mensah");
    expect(supportScopeLabel("records_set", null, null, "history")).toBe("A named set of records only");
    expect(supportScopeLabel("firm_settings", null, null, "request")).toBe("Firm settings");
    expect(supportOpened(0, "expired")).toBe("Nothing opened");
    expect(supportOpened(1, "ended")).toBe("1 record, listed in Audit");
    expect(supportOpened(3, "ended")).toBe("3 records, all listed in Audit");
    expect(supportOpened(5, "cancelled")).toBe("Nothing");
    expect(supportPill(0)).toBe("No support requests");
    expect(supportPill(2)).toBe("2 support requests");
  });

  it("reads only a well-formed answer from the database", () => {
    expect(readSupportAccess(null)).toBeNull();
    expect(readSupportAccess("nope")).toBeNull();
    expect(readSupportAccess({ alert: { id: "x", scope: "everything", ends_at: "2026-10-18T15:08:00Z" }, request: null, pending: 2, history: [{ id: "h", scope: "matter_all" }, { nope: 1 }] })).toEqual({
      alert: null,
      request: null,
      pending: 2,
      history: [{ id: "h", scope: "matter_all" }],
    });
    expect(readSupportAccess(SUPPORT)).toEqual(SUPPORT);
  });

  it("reads DD/MM/YYYY and refuses dates that don't exist", () => {
    expect(readGrantDate("28/10/2026")).toBe("2026-10-28");
    expect(readGrantDate("2026-10-28")).toBe("2026-10-28");
    expect(readGrantDate("31/02/2026")).toBeNull();
    expect(readGrantDate("10/28/2026")).toBeNull();
    expect(readGrantDate("")).toBeNull();
  });
});
