import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApprovalFollowUpDialogs } from "@/components/sheet/designer/matter-approval-follow-up";
import { RenewalPanel } from "@/components/sheet/designer/matter-renewal";
import { buildApprovalFollowUp, followUpError, type ApprovalInput, type FollowUpStepRow } from "@/modules/decisions/present";
import { ATTEST_LABEL } from "@/modules/government/page-attestation";
import { portalRenewals, renewalError } from "@/modules/renewals/present";
import { buildRenewalPanel, type RenewalInput, type TimingRow } from "@/modules/sheet/renewal-present";

/**
 * DEC-02 follows the GOV review rules (decided 2026-10-24): a follow-up step or renewal timing
 * approved without a page capture shows "page not captured by Casevoya, checked by <reviewer> on
 * <date>" next to it (staff and, for timings, the client's portal); Approve on an uncaptured entry
 * opens the reviewer's attestation; the refusals read plainly. Synthetic values only.
 */
const PAGE = "https://www.canada.ca/en/synthetic-test-page.html#synthetic-section";
const memberName = (id: string | null) => (id === "m-consultant" ? "Amara Osei" : id ? "Daniel Ruiz" : "Unassigned");

const step = (over: Partial<FollowUpStepRow> = {}): FollowUpStepRow => ({
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
  snapshot_sha256: null,
  status: "approved",
  reviewed_by_membership_id: "m-consultant",
  reviewed_at: "2026-10-24T15:00:00Z",
  review_note: null,
  version: 2,
  page_attested_by_membership_id: "m-consultant",
  page_attested_on: "2026-10-24",
  ...over,
});

const approvalInput = (over: Partial<ApprovalInput> = {}): ApprovalInput => ({
  organizationId: "org",
  matterId: "matter",
  role: "licensed_consultant",
  licensed: true,
  timezone: "America/Toronto",
  today: "2026-10-24",
  nowLocal: "2026-10-24T10:00",
  memberName,
  userName: () => "Daniel Ruiz",
  approval: { id: "decision", state: "confirmed", confirmedAt: "2026-10-22T14:00:00Z" },
  programKey: "synthetic_program",
  steps: [],
  events: [],
  closure: [],
  summaries: [],
  deliveries: [],
  files: [],
  ...over,
});

const timing = (over: Partial<TimingRow> = {}): TimingRow => ({
  id: "tm1",
  program_key: null,
  applies_to: "Synthetic permit",
  timing_text: "Synthetic timing words",
  lead_days: 45,
  source_url: PAGE,
  source_section: null,
  form_number: null,
  form_modified_on: null,
  checked_on: "2026-10-20",
  current_to: null,
  snapshot_sha256: null,
  status: "approved",
  version: 2,
  page_attested_by_membership_id: "m-consultant",
  page_attested_on: "2026-10-24",
  ...over,
});

const renewalInput = (over: Partial<RenewalInput> = {}): RenewalInput => ({
  organizationId: "org",
  role: "licensed_consultant",
  licensed: true,
  today: "2026-10-24",
  timezone: "America/Toronto",
  decisionId: "d1",
  sample: false,
  closed: false,
  program: null,
  renewals: [],
  tasks: new Map(),
  timings: [],
  fees: [],
  contact: { allowed: true, reason: "Synthetic reason.", name: "Synthetic Client" },
  files: [],
  memberName,
  ...over,
});

describe("Approval follow-up steps", () => {
  it("show the attestation next to an approved step without a snapshot", () => {
    const built = buildApprovalFollowUp(approvalInput({ steps: [step()] }));
    expect(built?.card.official[0].source?.facts.join(", ")).toContain("page not captured by Casevoya, checked by Amara Osei on 24 Oct");
  });

  it("open the attestation dialog from Approve when the step has no snapshot; a snapshot approves directly", () => {
    const pending = step({ status: "pending_review", page_attested_on: null, page_attested_by_membership_id: null, version: 1 });
    const built = buildApprovalFollowUp(approvalInput({ steps: [pending] }));
    expect(built?.card.pending[0].approve).toMatchObject({ "data-dec": "attest-open", "data-id": "step-1", "data-version": "1" });
    expect(built?.dialogs.attest).toEqual({ wire: { "data-dec": "attest", "data-org": "org", "data-matter": "matter" }, today: "2026-10-24" });
    const html = renderToStaticMarkup(createElement(ApprovalFollowUpDialogs, { data: built!.dialogs }));
    expect(html).toContain('id="dDecAtt"');
    expect(html).toContain(ATTEST_LABEL);
    const captured = buildApprovalFollowUp(approvalInput({ steps: [{ ...pending, snapshot_sha256: "e".repeat(64) }] }));
    expect(captured?.card.pending[0].approve).toMatchObject({ "data-dec": "review" });
    expect(captured?.dialogs.attest).toBeNull();
  });

  it("read the self-approval refusal plainly, for steps and the conditions summary", () => {
    expect(followUpError("you entered this yourself, so another licensed member of the firm approves it")).toBe(
      "You entered this yourself, so another licensed member of the firm approves it.",
    );
  });
});

describe("Renewal timings", () => {
  it("show the attestation next to the timing, on the card and on a reminder that follows it", () => {
    const panel = buildRenewalPanel(renewalInput({ timings: [timing()] }));
    expect(panel.timings[0].source.facts).toContain("page not captured by Casevoya, checked by Amara Osei on 24 Oct 2026");
  });

  it("open the attestation dialog from Approve when the timing has no snapshot", () => {
    const pending = timing({ id: "tm3", status: "pending_review", page_attested_on: null, page_attested_by_membership_id: null, version: 1 });
    const panel = buildRenewalPanel(renewalInput({ timings: [pending] }));
    expect(panel.pending[0].approve).toMatchObject({ "data-ren": "attest-open", "data-id": "tm3", "data-version": "1" });
    expect(panel.dialogs.attest).toEqual({ wire: { "data-ren": "attest", "data-org": "org" }, today: "2026-10-24" });
    const html = renderToStaticMarkup(createElement(RenewalPanel, { data: panel }));
    expect(html).toContain('id="dRenAtt"');
    expect(html).toContain(ATTEST_LABEL);
    expect(buildRenewalPanel(renewalInput({ timings: [{ ...pending, snapshot_sha256: "a".repeat(64) }] })).dialogs.attest).toBeNull();
  });

  it("carry the attestation to the client's portal reminder", () => {
    const views = portalRenewals(
      [
        {
          id: "r1",
          document_label: "Synthetic permit",
          expires_on: "2027-03-12",
          remind_on: "2027-01-26",
          service_scope: null,
          timing: { text: "Synthetic timing words", source_url: PAGE, checked_on: "2026-10-20", current_to: null, snapshot_sha256: null, page_attested_on: "2026-10-24", page_attested_by: "Amara Osei" },
          fee: null,
        },
      ],
      "Synthetic Firm",
      "America/Toronto",
    );
    expect(views[0].timing?.facts).toContain("page not captured by Casevoya, checked by Amara Osei on 24 Oct 2026");
  });

  it("read the attestation and self-approval refusals plainly", () => {
    expect(renewalError("Casevoya has no capture of this page: approving it needs your attestation that you opened the official page yourself and the entry matches it")).toMatch(
      /Tick that you opened the official page yourself/,
    );
    expect(renewalError("you entered this yourself, so another licensed member of the firm approves it")).toBe(
      "You entered this yourself, so another licensed member of the firm approves it.",
    );
  });
});
