import { describe, expect, it } from "vitest";
import { governmentError, letterChannel, letterKind } from "@/modules/government/present";
import {
  buildDecisions,
  buildGovernmentPage,
  buildSubmissions,
  type DecisionRow,
  type GovernmentContext,
  type GovernmentRecords,
  type HandoffRow,
  type LetterRow,
} from "@/modules/sheet/government-present";

const NOW = new Date("2026-10-18T14:00:00Z");

function ctx(over: Partial<GovernmentContext> = {}): GovernmentContext {
  return {
    organizationId: "org",
    matterId: "matter",
    stage: "ready_to_submit",
    timezone: "America/Toronto",
    today: "2026-10-18",
    now: NOW,
    memberName: (id) => (id === "m-consultant" ? "Amara Osei" : id ? "Daniel Ruiz" : "Unassigned"),
    userName: (id) => (id ? "Daniel Ruiz" : "Someone at the firm"),
    consultant: "Amara Osei",
    me: "Daniel Ruiz",
    role: "case_manager",
    licensed: false,
    representatives: [{ id: "m-consultant", name: "Amara Osei" }],
    ...over,
  };
}

function records(over: Partial<GovernmentRecords> = {}): GovernmentRecords {
  return {
    handoffs: [],
    letters: [],
    decisions: [],
    followUps: [],
    steps: [],
    checks: [],
    transitions: [],
    deadlines: [],
    representation: true,
    documents: { total: 4, open: 1 },
    expiring: [],
    ...over,
  };
}

function handoff(over: Partial<HandoffRow>): HandoffRow {
  return {
    id: "h1",
    package_label: "Package v3",
    package_sha256: "a".repeat(64),
    channel: "online_portal",
    status: "awaiting_signoff",
    signoff_membership_id: null,
    signed_off_at: null,
    submitted_by_membership_id: null,
    external_reference: null,
    submitted_at: null,
    receipt_version_id: null,
    receipt_locator: null,
    acknowledged_on: null,
    verified_by_membership_id: null,
    verified_at: null,
    cancel_reason: null,
    cancelled_at: null,
    created_by: "u1",
    created_at: "2026-10-15T15:00:00Z",
    version: 1,
    ...over,
  };
}

function letter(over: Partial<LetterRow>): LetterRow {
  return {
    id: "l1",
    kind: "request",
    channel: "portal_message",
    received_on: "2026-10-12",
    document_date: "2026-10-08",
    action_requested: null,
    stated_deadline: null,
    evidence_version_id: null,
    evidence_locator: "Synthetic letter, page 1",
    verified_by_membership_id: null,
    verified_at: null,
    shared_with_client_at: null,
    created_by: "u1",
    created_at: "2026-10-12T16:00:00Z",
    version: 1,
    ...over,
  };
}

function decision(over: Partial<DecisionRow>): DecisionRow {
  return {
    id: "d1",
    correspondence_id: "l1",
    outcome: "refused",
    milestone: null,
    decided_on: null,
    authority_reasons: "Synthetic quoted reasons",
    state: "awaiting_confirmation",
    consultant_interpretation: null,
    next_steps: null,
    confirmed_by_membership_id: null,
    confirmed_at: null,
    created_by: "u1",
    created_at: "2026-10-16T15:00:00Z",
    version: 1,
    ...over,
  };
}

describe("government present: submissions (T036)", () => {
  it("offers to start a handoff on an open matter, and nothing to a finance user", () => {
    const built = buildSubmissions(records(), ctx());
    expect(built.tab.package).toBeNull();
    expect(built.tab.start).toEqual({ "data-open": "dSubPrep" });
    expect(built.dialogs.prepare?.wire).toMatchObject({ "data-gov": "prepare", "data-matter": "matter" });
    expect(buildSubmissions(records(), ctx({ role: "finance_user" })).tab.start).toBeNull();
    expect(buildSubmissions(records(), ctx({ stage: "intake" })).tab.start).toBeNull();
  });

  it("opens sign-off only to a licensed consultant with representation on file, and says why otherwise", () => {
    const open = records({ handoffs: [handoff({})] });
    expect(buildSubmissions(open, ctx()).tab.package?.hold).toBeNull();
    expect(buildSubmissions(open, ctx()).tab.package?.why?.text).toBe("A licensed consultant signs off the package");
    expect(buildSubmissions({ ...open, representation: false }, ctx({ licensed: true })).tab.package?.why?.text).toBe(
      "Opens when representation authority is on file",
    );
    const ready = buildSubmissions(open, ctx({ licensed: true })).tab.package;
    expect(ready?.hold).toMatchObject({ "data-gov": "signoff", "data-id": "h1", "data-version": "1" });
    expect(ready?.checks.every((check) => check.wire?.["data-gov"] === "ro")).toBe(true);
    expect(ready?.hash).toBe("sha256 aaaa…aaaa");
  });

  it("never says Submitted without a receipt", () => {
    const unverified = handoff({
      status: "submission_unverified",
      signed_off_at: "2026-10-16T15:00:00Z",
      signoff_membership_id: "m-consultant",
      submitted_at: "2026-10-17T15:00:00Z",
      submitted_by_membership_id: "m-consultant",
      external_reference: "SYN-1",
    });
    const built = buildSubmissions(records({ handoffs: [unverified] }), ctx());
    expect(built.tab.records[0].badge).toEqual({ tone: "unv", label: "Submission unverified" });
    expect(built.tab.records[0].action?.wire).toEqual({ "data-open": "dSubRcpt" });
    expect(built.dialogs.receipt?.wire).toMatchObject({ "data-gov": "receipt", "data-id": "h1" });
    const page = buildGovernmentPage(records({ handoffs: [unverified] }), ctx({ stage: "submitted" }));
    expect(page.alert?.upload).toMatchObject({ "data-gov": "receipt-file", "data-id": "h1" });
    expect(page.rows[0].status.label).toBe("Submission unverified");
    expect(JSON.stringify(page)).not.toMatch(/Submitted to government/);
  });

  it("flags a matter at Submitted with no verified handoff on record", () => {
    const page = buildGovernmentPage(records(), ctx({ stage: "government_processing" }));
    expect(page.alert?.copy).toContain("no verified submission is recorded here");
    expect(page.alert?.upload).toEqual({ "data-nav": "/sheet/matters/matter?tab=submissions" });
  });
});

describe("government present: letters and decisions (T037, T038)", () => {
  it("keeps each letter with its received date and offers Verify only to a role that may verify", () => {
    const data = records({
      letters: [letter({ id: "l2", received_on: "2026-10-15" }), letter({})],
      deadlines: [{ correspondence_id: "l1", due_on: "2026-11-12" }],
    });
    const built = buildDecisions(data, ctx());
    expect(built.letters).toHaveLength(2);
    expect(built.letters[1].parts).toEqual(["Received 12 Oct by portal message", "dated 8 Oct", "recorded by Daniel", "created the 12 Nov deadline"]);
    expect(built.letters[1].verify).toMatchObject({ "data-gov": "verify-letter", "data-id": "l1" });
    expect(buildDecisions(data, ctx({ role: "assistant" })).letters[1].verify).toBeNull();
    const page = buildGovernmentPage(data, ctx());
    expect(page.rows.filter((row) => row.item === "Request for documents")).toHaveLength(2);
  });

  it("offers Record the decision once the decision letter is verified", () => {
    const unverified = records({ letters: [letter({ kind: "decision" })] });
    expect(buildDecisions(unverified, ctx()).recordForm).toBeNull();
    const verified = records({ letters: [letter({ kind: "decision", verified_at: "2026-10-16T15:00:00Z", verified_by_membership_id: "m2" })] });
    expect(buildDecisions(verified, ctx()).recordForm?.wire).toMatchObject({ "data-gov": "decision", "data-id": "l1" });
  });

  it("shows a refusal as urgent, keeps reasons apart from interpretation, and lets only a licensed consultant confirm", () => {
    const data = records({ letters: [letter({ kind: "decision", verified_at: "2026-10-16T15:00:00Z" })], decisions: [decision({})] });
    const view = buildDecisions(data, ctx()).decision;
    expect(view?.badge).toEqual({ tone: "bad", label: "Urgent consultant review" });
    expect(view?.reasons).toBe("Synthetic quoted reasons");
    expect(view?.interpretation).toBeNull();
    expect(view?.record?.confirmedBy).toBe("Waiting for Amara");
    expect(view?.confirm).toBeNull();
    expect(buildDecisions(data, ctx({ licensed: true })).decision?.confirm?.wire).toMatchObject({ "data-gov": "confirm", "data-id": "d1" });
  });

  it("records withdrawal steps once each, and offers expiry reminders after confirmation", () => {
    const withdrawn = records({
      letters: [letter({ kind: "decision", verified_at: "2026-10-16T15:00:00Z" })],
      decisions: [decision({ outcome: "withdrawn" })],
      steps: [{ decision_id: "d1", step: "withdrawal_instructions", note: null, done_by_membership_id: "m2", done_at: "2026-10-16T15:00:00Z" }],
    });
    const steps = buildDecisions(withdrawn, ctx()).decision?.steps ?? [];
    expect(steps[0]).toMatchObject({ done: true, wire: { "data-gov": "ro" } });
    expect(steps[1].wire).toMatchObject({ "data-gov": "step", "data-step": "consultant_review" });
    expect(buildDecisions(withdrawn, ctx()).decision?.badge.label).toBe("In progress, 1 of 5");

    const approved = records({
      letters: [letter({ kind: "decision", verified_at: "2026-10-16T15:00:00Z" })],
      decisions: [decision({ outcome: "approved", milestone: "final_approval", state: "confirmed", confirmed_at: "2026-10-17T15:00:00Z", confirmed_by_membership_id: "m-consultant", next_steps: "Synthetic next steps" })],
      expiring: [{ versionId: "v1", purpose: "Synthetic permit", expiresOn: "2028-03-12" }],
    });
    const view = buildDecisions(approved, ctx()).decision;
    expect(view?.badge.label).toBe("Confirmed by Amara Osei, 17 Oct 2026");
    expect(view?.summary?.copy).toBe("Synthetic next steps");
    expect(view?.followUps[0]).toMatchObject({ title: "Add expiry reminder: Synthetic permit expires 12 Mar 2028", wire: { "data-gov": "expiry", "data-doc": "v1", "data-due": "2028-03-12" } });
  });
});

describe("government present: words", () => {
  it("maps the Designer's letter dialog to stored kinds and channels", () => {
    expect(letterKind("Procedural fairness letter")).toBe("procedural_fairness");
    expect(letterKind("Decision")).toBe("decision");
    expect(letterKind("Anything")).toBeNull();
    expect(letterChannel("IRCC portal message")).toBe("portal_message");
    expect(letterChannel("Fax")).toBeNull();
  });

  it("turns database refusals into the Sheet's own copy, never the database message", () => {
    expect(governmentError("representation authority must be on file before sign-off")).toBe("Record the representation authority on this matter before sign-off.");
    expect(governmentError("a submission is recorded only after consultant sign-off")).toContain("signs off the package");
    expect(governmentError("something internal")).toBe("That couldn’t be saved.");
  });
});
