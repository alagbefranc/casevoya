import { describe, expect, it } from "vitest";
import { complaintsDialogs, presentComplaints, type ComplaintRowData, type ComplaintsContext } from "@/modules/compliance/complaints-present";
import { complianceError, dmy, readDate, readDays } from "@/modules/compliance/format";
import { presentPrivacy, privacyDialogs, type PrivacyContext, type PrivacyRequestRow } from "@/modules/compliance/privacy-present";

/** Privacy requests and complaints presentation: firm targets only, honest steps, role-aware actions. */

const CTX: PrivacyContext = {
  organizationId: "org",
  timezone: "UTC",
  today: "2026-10-18",
  userName: (id) => (id === "u-owner" ? "Owner One" : "Staff member"),
  memberName: (id) => (id === "m-cm" ? "Case Manager" : "Owner One"),
  myMemberships: ["m-cm"],
  isOwner: false,
  canRecord: true,
  privacyContact: null,
  selectedId: undefined,
};

function request(overrides: Partial<PrivacyRequestRow> = {}): PrivacyRequestRow {
  return {
    id: "r1",
    reference: "PR-001",
    kind: "access",
    requester_name: "Dana Lee",
    person_id: "p1",
    details: "A copy of my file",
    channel: "email",
    received_on: "2026-10-10",
    target_days: null,
    due_on: null,
    assignee_membership_id: "m-cm",
    identity_verified_at: null,
    identity_method: null,
    scope_at: null,
    scope_note: null,
    redaction_at: null,
    redaction_note: null,
    reviewed_at: null,
    reviewed_by: null,
    review_note: null,
    closed_at: null,
    outcome: null,
    outcome_note: null,
    refusal_reason: null,
    delivery_method: null,
    evidence_note: null,
    ...overrides,
  };
}

describe("compliance format", () => {
  it("reads and writes the Designer's DD/MM/YYYY dates and firm target days", () => {
    expect(readDate("17/10/2026")).toBe("2026-10-17");
    expect(readDate("2026-10-17")).toBe("2026-10-17");
    expect(readDate("31/02/2026")).toBeNull();
    expect(readDate("tomorrow")).toBeNull();
    expect(dmy("2026-01-05")).toBe("05/01/2026");
    expect(readDays("", 1, 365)).toEqual({ days: null });
    expect(readDays("21", 1, 365)).toEqual({ days: 21 });
    expect(readDays("0", 1, 365)).toHaveProperty("error");
    expect(readDays("2.5", 1, 60)).toHaveProperty("error");
  });

  it("words database refusals plainly and never echoes them", () => {
    expect(complianceError("records are never deleted here: refuse the deletion with a reason")).toMatch(/never deletes/);
    expect(complianceError("firm owner step-up is required")).toBe("Confirm with your authenticator, passkey, or a recovery code, then try again.");
    expect(complianceError("some internal detail")).toBe("That action could not be completed.");
  });
});

describe("privacy requests page", () => {
  it("shows only the firm's own target, never a legal deadline", () => {
    const none = presentPrivacy({ ctx: CTX, rows: [request()], lines: [], consents: null, kept: null });
    expect(none.page.rows?.[0]).toMatchObject({ ref: "PR-001", due: null, state: { tone: "rev", label: "Identity to check" }, href: "/sheet/privacy?view=r1" });
    expect(none.page.selected?.deadline.rows[0]).toEqual({ term: "Firm target", value: "None set" });
    const set = presentPrivacy({ ctx: CTX, rows: [request({ target_days: 21, due_on: "2026-10-31" })], lines: [], consents: null, kept: null });
    expect(set.page.rows?.[0].due).toBe("31 Oct 2026");
    expect(set.page.selected?.deadline.rows[0]).toEqual({ term: "Firm target", value: ["21 days from receipt", "31 Oct 2026"] });
    const text = JSON.stringify([none, set]);
    expect(text).not.toMatch(/Legal deadline|statutory|30 days/i);
    // Past the firm's target.
    const late = presentPrivacy({ ctx: CTX, rows: [request({ target_days: 3, due_on: "2026-10-13" })], lines: [], consents: null, kept: null });
    expect(late.page.rows?.[0].state).toEqual({ tone: "bad", label: "Past target", detail: "identity to check" });
    // Privacy contact pill and the record button follow the viewer.
    expect(none.header).toEqual({ pills: ["1 open", "Privacy contact: not set"], actions: [{ label: "Record a request", primary: true, attrs: { "data-dlg": "dlgPR" } }] });
  });

  it("walks an access request through identity, scope, redaction and review", () => {
    const row = request({ identity_verified_at: "2026-10-11T15:00:00Z", identity_method: "Video call", scope_at: "2026-10-12T10:00:00Z", scope_note: "MI-1: 12 records" });
    const lines = [
      { id: "l1", request_id: "r1", record_label: "Intake p.4", third_party: "Spouse", removed: "Address", state: "redacted", done_by: "u-owner" },
      { id: "l2", request_id: "r1", record_label: "Call note", third_party: "Child", removed: "Health detail", state: "to_do", done_by: null },
    ];
    const out = presentPrivacy({ ctx: CTX, rows: [row], lines, consents: null, kept: null });
    const selected = out.page.selected!;
    expect(selected.steps.map((step) => [step.title, step.state])).toEqual([
      ["Identity verified", "done"],
      ["Scope searched", "done"],
      ["Third-party information redacted", "now"],
      ["Reviewed", ""],
      ["Exported and delivered", ""],
    ]);
    expect(selected.steps[0].small).toBe("Video call, 11 Oct");
    expect(selected.steps[2].small).toEqual(["2 lines on the worklist", "1 of 2 done"]);
    expect(selected.worklist?.rows[1].attrs).toMatchObject({ "data-redaction-edit": "l2", "data-state": "to_do" });
    expect(selected.worklist?.rows[0].cells[3]).toEqual({ text: "Owner One" });
    expect(selected.deadline.actions.map((action) => action.label)).toEqual(["Mark redaction done", "Add redaction line", "Close request"]);
    const dialogs = privacyDialogs({ ctx: CTX, selectedRow: out.selectedRow, record: null, consents: null, settingsDays: null });
    expect(dialogs.step).toMatchObject({ step: "redaction", requestId: "r1" });
    expect(dialogs.redaction).toEqual({ requestId: "r1", reference: "PR-001" });
    expect(dialogs.settings).toBeNull();
  });

  it("lets only the firm owner close a deletion request, and only as refused or withdrawn", () => {
    const row = request({ kind: "deletion" });
    const kept = [{ matter_id: "mt", reference: "MI-2026-0001", reason: "retention", retention_on: "2032-10-01" }];
    const staff = presentPrivacy({ ctx: CTX, rows: [row], lines: [], consents: null, kept });
    expect(staff.page.selected?.deadline.actions.map((action) => action.label)).toEqual(["Record identity check"]);
    expect(staff.page.selected?.deadline.rows).toContainEqual({ term: "Closing", value: "Only the firm owner closes a deletion request" });
    expect(staff.page.selected?.worklist?.rows[0].cells).toEqual([{ text: "MI-2026-0001" }, { text: "Retention period" }, { text: "1 Oct 2032" }]);
    expect(staff.page.selected?.notes.join(" ")).toMatch(/never deletes records/);
    expect(privacyDialogs({ ctx: CTX, selectedRow: staff.selectedRow, record: null, consents: null, settingsDays: null }).close).toBeNull();
    const owner = { ...CTX, isOwner: true, myMemberships: ["m-owner"] };
    const dialogs = privacyDialogs({ ctx: owner, selectedRow: row, record: null, consents: null, settingsDays: 30 });
    expect(dialogs.close?.outcomes.map(([value]) => value)).toEqual(["refused", "withdrawn"]);
    expect(dialogs.settings).toEqual({ days: "30" });
  });

  it("offers only the person's active consents when closing a withdrawal", () => {
    const row = request({ kind: "consent_withdrawal" });
    const consents = [
      { id: "c1", purpose: "contact_sms", created_at: "2026-09-01T12:00:00Z", granted: true, withdrawn_at: null },
      { id: "c2", purpose: "contact_email", created_at: "2026-09-01T12:00:00Z", granted: true, withdrawn_at: "2026-09-20T12:00:00Z" },
    ];
    const out = presentPrivacy({ ctx: CTX, rows: [row], lines: [], consents, kept: null });
    expect(out.page.selected?.worklist?.rows.map((r) => r.cells[2])).toEqual([{ badge: { tone: "ok", label: "Active" } }, { badge: { tone: "gr", label: "Withdrawn 20 Sep" } }]);
    expect(privacyDialogs({ ctx: CTX, selectedRow: row, record: null, consents, settingsDays: null }).close?.consents).toEqual([["c1", "Text messages, given 1 Sep 2026"]]);
  });

  it("shows a closed request's outcome, and nothing to staff outside privacy work", () => {
    const row = request({ closed_at: "2026-10-16T12:00:00Z", outcome: "refused", refusal_reason: "Not their records", identity_verified_at: "2026-10-11T12:00:00Z" });
    const out = presentPrivacy({ ctx: CTX, rows: [row], lines: [], consents: null, kept: null });
    expect(out.page.rows?.[0].state).toEqual({ tone: "bad", label: "Refused 16 Oct" });
    expect(out.page.selected?.deadline.actions).toEqual([]);
    expect(out.page.selected?.notes).toContain("Reason for refusing: Not their records");
    const outsider = presentPrivacy({ ctx: { ...CTX, canRecord: false }, rows: null, lines: [], consents: null, kept: null });
    expect(outsider.page).toEqual({ rows: null, selected: null });
    expect(outsider.header).toEqual({ pills: ["Privacy contact: not set"], actions: [] });
  });
});

const CCTX: ComplaintsContext = {
  organizationId: "org",
  firmName: "Maple Immigration",
  today: "2026-10-18",
  isOwner: true,
  isHandler: true,
  userName: () => "Owner One",
  memberName: () => "Owner One",
  matterRef: (id) => (id ? "MI-2026-0001" : "—"),
  visibleTo: ["Owner One", "Lee Park"],
  escalation: null,
  selectedId: undefined,
};

function complaint(overrides: Partial<ComplaintRowData> = {}): ComplaintRowData {
  return {
    id: "c1",
    reference: "CP-001",
    complainant_name: "Dana Lee",
    matter_id: "mt",
    category: "fees_billing",
    channel: "email",
    issue: "Fees explained late",
    received_on: "2026-10-09",
    ack_due_on: null,
    response_due_on: null,
    assignee_membership_id: "m-owner",
    acknowledged_on: null,
    reviewed_at: null,
    reviewed_by: null,
    evidence_note: null,
    response_sent_on: null,
    response_note: null,
    resolved_on: null,
    resolution: null,
    ...overrides,
  };
}

describe("complaints register", () => {
  it("lists complaints with the firm's own targets and escalation text, never invented ones", () => {
    const out = presentComplaints({ ctx: CCTX, rows: [complaint({ acknowledged_on: "2026-10-10", ack_due_on: "2026-10-11", response_due_on: "2026-10-23" })] });
    expect(out.header).toEqual({
      pills: ["Visible to: Owner One, Lee Park"],
      actions: [
        { label: "Settings", attrs: { "data-dlg": "dlgCS" } },
        { label: "Record a complaint", primary: true, attrs: { "data-dlg": "dlgC" } },
      ],
    });
    expect(out.page.rows?.[0]).toMatchObject({ matter: "MI-2026-0001", next: "Review the evidence", state: { tone: "chg", label: "Acknowledged 10 Oct" } });
    expect(out.page.selected?.steps[1]).toEqual({ state: "done", title: "Acknowledged", small: ["10 Oct", "within the firm’s target"] });
    expect(out.page.selected?.rows).toContainEqual({ term: "Escalation", value: "Not set. The firm owner adds your firm’s escalation path in Settings." });
    expect(out.page.selected?.rows).toContainEqual({ term: "Routes to", value: "Maple Immigration (professional service)" });
    expect(JSON.stringify(out)).not.toMatch(/business days|CICC|statutory/i);
    const withText = presentComplaints({ ctx: { ...CCTX, escalation: "Write to the firm owner." }, rows: [complaint()] });
    expect(withText.page.selected?.rows).toContainEqual({ term: "Escalation", value: "Write to the firm owner." });
  });

  it("flags a missed acknowledgement target and resolves in order", () => {
    const late = presentComplaints({ ctx: CCTX, rows: [complaint({ ack_due_on: "2026-10-11" })] });
    expect(late.page.rows?.[0]).toMatchObject({ next: "Acknowledge by 11 Oct", state: { tone: "bad", label: "Past acknowledgement target" } });
    expect(late.page.selected?.actions).toEqual([{ label: "Record acknowledgement", primary: true, attrs: { "data-dlg": "dlgCStep" } }]);
    const resolved = presentComplaints({
      ctx: CCTX,
      rows: [complaint({ acknowledged_on: "2026-10-10", reviewed_at: "2026-10-11T12:00:00Z", evidence_note: "Quote", response_sent_on: "2026-10-12", resolved_on: "2026-10-14", resolution: "Apology and refund" })],
    });
    expect(resolved.page.rows?.[0]).toMatchObject({ next: "—", state: { tone: "ok", label: "Resolved 14 Oct" } });
    expect(resolved.page.selected?.actions).toEqual([]);
    expect(resolved.page.selected?.steps.every((step) => step.state === "done")).toBe(true);
  });

  it("shows staff outside the register no rows, no names and no buttons", () => {
    const ctx = { ...CCTX, isOwner: false, isHandler: false };
    const out = presentComplaints({ ctx, rows: [complaint()] });
    expect(out.page.rows).toBeNull();
    expect(out.page.selected).toBeNull();
    expect(out.header).toEqual({ pills: [], actions: [] });
    const dialogs = complaintsDialogs({ ctx, selectedRow: null, people: [], matters: [], assignable: [], me: null, staff: [], handlers: [], settings: { ackDays: null, responseDays: null, escalation: null } });
    expect(dialogs).toMatchObject({ record: null, step: null, settings: null });
  });
});
