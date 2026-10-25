import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApprovalFollowUpDialogs } from "@/components/sheet/designer/matter-approval-follow-up";
import { MatterDecisionsLive, type MatterDecisionsData } from "@/components/sheet/designer/matter-government";
import {
  buildApprovalFollowUp,
  followUpError,
  portalFollowUp,
  withApprovalFollowUp,
  type ApprovalInput,
  type FollowUpStepRow,
} from "@/modules/decisions/present";

/**
 * DEC-02 presentation: the approval follow-up checklist lists closure tasks and only approved
 * official steps with their source next to them, says plainly when none is entered for the
 * program, keeps drafts away from the client, and shows the delivery record with its
 * acknowledgement. Synthetic values only (no IRCC content).
 */

const PAGE = "https://www.canada.ca/en/synthetic-test-page.html#synthetic-section";
const HASH = "e".repeat(64);

function step(over: Partial<FollowUpStepRow> = {}): FollowUpStepRow {
  return {
    id: "step-1",
    program_key: "synthetic_program",
    label: "Synthetic step after approval",
    timing_text: null,
    source_url: PAGE,
    source_section: null,
    form_number: null,
    form_modified_on: null,
    checked_on: "2026-10-20",
    current_to: null,
    snapshot_sha256: HASH,
    status: "approved",
    reviewed_by_membership_id: "m-consultant",
    reviewed_at: "2026-10-20T15:00:00Z",
    review_note: null,
    version: 2,
    ...over,
  };
}

function input(over: Partial<ApprovalInput> = {}): ApprovalInput {
  return {
    organizationId: "org",
    matterId: "matter",
    role: "case_manager",
    licensed: false,
    timezone: "America/Toronto",
    today: "2026-10-24",
    nowLocal: "2026-10-24T10:00",
    memberName: (id) => (id === "m-consultant" ? "Amara Osei" : id ? "Daniel Ruiz" : "Unassigned"),
    userName: (id) => (id ? "Daniel Ruiz" : "Someone at the firm"),
    approval: { id: "decision", state: "confirmed", confirmedAt: "2026-10-22T14:00:00Z" },
    programKey: "synthetic_program",
    steps: [],
    events: [],
    closure: [
      { kind: "conditions_summary", task: { id: "t-sum", title: "Send summary", status: "open", owner_membership_id: "m-consultant", version: 1 }, doneBy: null },
      {
        kind: "document_delivery",
        task: { id: "t-del", title: "Record document delivery", status: "done", owner_membership_id: "m-consultant", version: 2, completed_at: "2026-10-23T15:00:00Z" },
        doneBy: "Daniel Ruiz",
      },
      { kind: "expiry_reminder", task: { id: "t-exp", title: "Renewal review", status: "open", owner_membership_id: "m-consultant", version: 1 }, doneBy: null },
    ],
    summaries: [],
    deliveries: [],
    files: [{ versionId: "v-letter", label: "Decision letter" }],
    ...over,
  };
}

describe("DEC-02 follow-up checklist", () => {
  it("shows closure tasks and says plainly when no official step is entered for the program", () => {
    const built = buildApprovalFollowUp(input());
    expect(built).not.toBeNull();
    const card = built!.card;
    expect(card.closure.map((item) => [item.id, item.done])).toEqual([
      ["t-sum", false],
      ["t-del", true],
    ]);
    expect(card.closure[0].wire).toMatchObject({ "data-gov": "task-done", "data-id": "t-sum", "data-version": "1" });
    expect(card.closure[1].note).toBe("Done by Daniel Ruiz, 23 Oct");
    expect(card.official).toEqual([]);
    expect(card.officialEmpty).toMatch(/^No official follow-up steps entered for Synthetic program yet\./);
    expect(card.addStep).toEqual({ "data-open": "dDecStep" });
    expect(card.badge).toEqual({ tone: "rev", label: "1 of 2 done" });
  });

  it("lists only approved steps for the matter's program, with source, dates and hash, and the latest tick", () => {
    const built = buildApprovalFollowUp(
      input({
        steps: [
          step({ timing_text: "As the page words it", form_number: "SYN 0000", form_modified_on: "2026-09-01" }),
          step({ id: "step-other", program_key: "other_program" }),
          step({ id: "step-pending", status: "pending_review", snapshot_sha256: null, version: 1 }),
          step({ id: "step-retired", status: "retired" }),
        ],
        events: [
          { step_id: "step-1", ticked: true, membership_id: "m-consultant", created_at: "2026-10-23T16:00:00Z" },
          { step_id: "step-1", ticked: false, membership_id: "m-other", created_at: "2026-10-23T15:00:00Z" },
        ],
      }),
    )!;
    expect(built.card.official.map((item) => item.id)).toEqual(["step-1"]);
    const item = built.card.official[0];
    expect(item.done).toBe(true);
    expect(item.source?.href).toBe(PAGE);
    expect(item.source?.facts).toEqual(["SYN 0000, date modified 1 Sep", "checked 20 Oct", "snapshot sha256 eeee…eeee"]);
    expect(item.note).toBe("Timing on the page: “As the page words it” · Done by Amara Osei, 23 Oct");
    expect(item.wire).toMatchObject({ "data-dec": "tick", "data-step": "step-1", "data-ticked": "false" });
    expect(item.retire).toBeNull();
    expect(built.card.pending).toHaveLength(1);
    expect(built.card.pending[0].badge).toEqual({ tone: "bad", label: "No page snapshot" });
    expect(built.card.pending[0].approve).toBeNull();
    expect(built.card.officialEmpty).toBeNull();
  });

  it("keeps ticks closed until the approval is confirmed, and is absent with no approval or for a client", () => {
    const waiting = buildApprovalFollowUp(input({ approval: { id: "d", state: "awaiting_confirmation", confirmedAt: null }, steps: [step()], closure: [] }))!;
    expect(waiting.card.badge.label).toBe("Starts when the approval is confirmed");
    expect(waiting.card.official[0].wire).toBeNull();
    expect(waiting.card.summary.write).toBeNull();
    expect(waiting.card.recordDelivery).toBeNull();
    expect(buildApprovalFollowUp(input({ approval: null }))).toBeNull();
    expect(buildApprovalFollowUp(input({ role: "client" }))).toBeNull();
  });

  it("explains a matter without a program", () => {
    const built = buildApprovalFollowUp(input({ programKey: null, steps: [step()] }))!;
    expect(built.card.official).toEqual([]);
    expect(built.card.officialEmpty).toMatch(/no program set/);
    expect(built.card.addStep).toBeNull();
    expect(built.dialogs.step).toBeNull();
  });
});

describe("DEC-02 conditions summary and delivery record", () => {
  it("shows the approved version as the client's, the draft as not shown, and offers approval only to a licensed member", () => {
    const summaries = [
      { id: "s2", number: null, body: "Draft text of the synthetic summary.", status: "draft", drafted_by_membership_id: "m-other", approved_by_membership_id: null, approved_at: null, body_sha256: null, superseded_at: null, updated_at: "2026-10-24T13:00:00Z", version: 3 },
      { id: "s1", number: 1, body: "Approved text of the synthetic summary.", status: "approved", drafted_by_membership_id: "m-other", approved_by_membership_id: "m-consultant", approved_at: "2026-10-23T14:00:00Z", body_sha256: HASH, superseded_at: null, updated_at: "2026-10-23T14:00:00Z", version: 2 },
    ];
    const staff = buildApprovalFollowUp(input({ summaries }))!;
    expect(staff.card.summary.current?.line).toEqual(["Version 1", "approved by Amara Osei, 23 Oct", "sha256 eeee…eeee", "Shown to the client in the portal as the firm’s summary"]);
    expect(staff.card.summary.draft?.line).toContain("Not shown to the client");
    expect(staff.card.summary.draft?.approve).toBeNull();
    expect(staff.dialogs.summary?.wire).toMatchObject({ "data-dec": "revise-summary", "data-id": "s2", "data-version": "3" });
    const licensed = buildApprovalFollowUp(input({ summaries, licensed: true, role: "licensed_consultant" }))!;
    expect(licensed.card.summary.draft?.approve).toMatchObject({ "data-dec": "approve-summary", "data-id": "s2", "data-version": "3" });
  });

  it("lists deliveries with method, time and acknowledgement, and offers Record acknowledgement only while none is recorded", () => {
    const base = {
      document_version_id: "v-letter",
      document_label: "Decision letter",
      delivered_at: "2026-10-23T15:30:00Z",
      note: null,
      delivered_by_membership_id: "m-other",
      ack_evidence_version_id: null,
      version: 1,
    };
    const built = buildApprovalFollowUp(
      input({
        deliveries: [
          { ...base, id: "d1", method: "portal", acknowledgement: "client_portal", acknowledged_at: "2026-10-24T12:00:00Z", acknowledged_on: "2026-10-24", ack_recorded_by_membership_id: null, ack_evidence_note: null },
          { ...base, id: "d2", method: "email", acknowledgement: null, acknowledged_at: null, acknowledged_on: null, ack_recorded_by_membership_id: null, ack_evidence_note: null },
        ],
      }),
    )!;
    expect(built.card.deliveries[0]).toMatchObject({
      title: "Decision letter",
      parts: ["Client portal", "delivered 23 Oct", "recorded by Daniel Ruiz"],
      badge: { tone: "ok", label: "Acknowledged by the client in the portal, 24 Oct" },
      ack: null,
    });
    expect(built.card.deliveries[1].ack).toMatchObject({ "data-dec": "ack-open", "data-id": "d2" });
    expect(built.dialogs.ack).not.toBeNull();
    expect(built.card.recordDelivery).toEqual({ "data-open": "dDecDel" });
    const noFiles = buildApprovalFollowUp(input({ files: [] }))!;
    expect(noFiles.card.recordDelivery).toBeNull();
    expect(noFiles.card.deliveryNote).toMatch(/Store the decision letter/);
  });

  it("renders on the Decisions tab without listing a closure task twice, and the dialogs from the design system's parts", () => {
    const built = buildApprovalFollowUp(input({ steps: [step()] }))!;
    const decisions: MatterDecisionsData = {
      letter: true,
      letters: [],
      decision: {
        outcome: "approved",
        heading: "Approved",
        tint: { art: "post-decision", title: "Follow-ups", copy: "Copy" },
        badge: { tone: "ok", label: "Confirmed" },
        followUps: [
          { title: "Send summary", note: "No due date", owner: { name: "Amara Osei", initials: "AO" } as never, wire: { "data-gov": "task-done", "data-id": "t-sum" } },
          { title: "Add expiry reminder", note: "Adds a task", owner: { name: "Amara Osei", initials: "AO" } as never, wire: { "data-gov": "expiry", "data-id": "decision" } },
        ],
      },
    };
    const merged = withApprovalFollowUp(decisions, built.card);
    expect(merged.decision?.followUps.map((row) => row.title)).toEqual(["Add expiry reminder"]);
    const html = renderToStaticMarkup(createElement(MatterDecisionsLive, { data: merged }));
    expect(html).toContain('id="decFollow"');
    expect(html).toContain("Approval follow-up checklist");
    expect(html).toContain('href="https://www.canada.ca/en/synthetic-test-page.html#synthetic-section"');
    expect(html).toContain('id="decSummary"');
    expect(html).toContain('id="decDelivery"');
    const dialogs = renderToStaticMarkup(createElement(ApprovalFollowUpDialogs, { data: built.dialogs }));
    expect(dialogs).toContain('<dialog class="dlg wide" id="dDecStep"');
    expect(dialogs).toContain('<dialog class="dlg wide" id="dDecSum"');
    expect(dialogs).toContain('<dialog class="dlg wide" id="dDecDel"');
  });

  it("maps database refusals to the Sheet's copy", () => {
    expect(followUpError("follow-ups start after the consultant confirms the approval")).toBe("This opens once a licensed consultant confirms the approval.");
    // DEC follows the GOV review rules (2026-10-24): no snapshot asks for the reviewer's attestation.
    expect(followUpError("Casevoya has no capture of this page: approving it needs your attestation that you opened the official page yourself and the entry matches it")).toMatch(/Tick that you opened the official page yourself/);
    expect(followUpError("you entered this yourself, so another licensed member of the firm approves it")).toBe("You entered this yourself, so another licensed member of the firm approves it.");
    expect(followUpError("something unexpected")).toBe("That couldn’t be saved.");
  });
});

describe("DEC-02 portal", () => {
  it("shows the client only the approved summary for this matter, labelled as the firm's, and the deliveries", () => {
    const raw = {
      summaries: [
        { matter_id: "matter", number: 2, body: "Approved summary text.", approved_at: "2026-10-23T14:00:00Z" },
        { matter_id: "other", number: 1, body: "Another matter.", approved_at: "2026-10-20T14:00:00Z" },
      ],
      deliveries: [
        { id: "d1", matter_id: "matter", label: "Decision letter", method: "email", delivered_at: "2026-10-23T15:00:00Z", acknowledgement: null, acknowledged_at: null },
        { id: "d2", matter_id: "matter", label: "Decision letter", method: "in_person", delivered_at: "2026-10-23T15:00:00Z", acknowledgement: "staff_recorded", acknowledged_at: "2026-10-24T15:00:00Z" },
      ],
    };
    const view = portalFollowUp(raw, "matter", "Synthetic Firm", "America/Toronto")!;
    expect(view.summary).toEqual({
      body: "Approved summary text.",
      line: "Written by Synthetic Firm and approved by your consultant on 23 Oct 2026. This is your firm’s summary, not an IRCC document.",
    });
    expect(view.deliveries).toEqual([
      { id: "d1", title: "Decision letter", detail: "Email, 23 Oct 2026", acknowledged: null },
      { id: "d2", title: "Decision letter", detail: "In person, 23 Oct 2026", acknowledged: "Synthetic Firm recorded that you received it." },
    ]);
    expect(portalFollowUp({ summaries: [], deliveries: [] }, "matter", "Synthetic Firm", "America/Toronto")).toBeNull();
    expect(portalFollowUp(raw, null, "Synthetic Firm", "America/Toronto")).toBeNull();
  });
});
