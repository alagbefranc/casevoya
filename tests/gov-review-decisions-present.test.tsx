import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GovStatusDialogs } from "@/components/sheet/designer/gov-status-dialogs";
import { IssuerList } from "@/components/sheet/designer/letter-form";
import { SubmissionChecklistDialogs } from "@/components/sheet/designer/matter-submissions-checklist";
import { issuerSourceParts, letterError, type IssuerRow } from "@/modules/government/letters";
import { ATTEST_LABEL, attestationError, attestationNote, readAttestation } from "@/modules/government/page-attestation";
import { estimateSource, provenanceError, type EstimateRow } from "@/modules/government/status-provenance";
import { buildGovernmentPage, type GovernmentContext, type GovernmentRecords } from "@/modules/sheet/government-present";
import { issuerList, letterIssuerParts } from "@/modules/sheet/letter-present";
import { buildSubmissionChecklist, type ChecklistInput } from "@/modules/sheet/matter-submissions-present";
import { checklistError, provenance, type RequirementRow } from "@/modules/submissions/present";

/**
 * The 2026-10-24 review decisions in the Sheet: an entry approved without a page capture shows
 * "page not captured by Casevoya, checked by <reviewer> on <date>" next to its value (official steps
 * and channel names, issuers, IRCC estimates); Approve on an uncaptured entry asks for the
 * reviewer's attestation; the database's refusals read plainly. Synthetic values only.
 */
const NAMES: Record<string, string> = { "m-consultant": "Amara Osei", "m-owner": "Olivia Owner" };
const memberName = (id: string | null) => (id ? (NAMES[id] ?? "Daniel Ruiz") : "Unassigned");
const NOT_CAPTURED = /^page not captured by Casevoya, checked by Amara Osei on 24 Oct 2026$/;

const requirement = (over: Partial<RequirementRow> = {}): RequirementRow => ({
  id: "r1",
  program_key: null,
  channel: "online_portal",
  kind: "outside_step",
  label: "Synthetic step as worded on the page",
  source_url: "https://www.canada.ca/en/synthetic-test-page.html#synthetic-section",
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

const longDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
};

function checklistInput(over: Partial<ChecklistInput> = {}): ChecklistInput {
  return {
    organizationId: "org",
    matterId: "matter",
    role: "licensed_consultant",
    licensed: true,
    timezone: "America/Toronto",
    today: "2026-10-24",
    memberName,
    state: {
      handoff_id: "h1",
      channel: "online_portal",
      program_key: null,
      gates: [{ key: "outside_steps", state: "blocked", total: 1, done: 0 }],
      blocked: ["outside_steps"],
    },
    requirements: [requirement()],
    events: [],
    manifest: null,
    ...over,
  };
}

const issuer = (over: Partial<IssuerRow> = {}): IssuerRow => ({
  id: "i1",
  name: "Synthetic Office",
  source_url: "https://www.canada.ca/en/synthetic.html#office",
  checked_on: "2026-10-23",
  retrieved_at: null,
  snapshot_sha256: null,
  page_modified_on: null,
  name_on_page: null,
  status: "approved",
  review_note: null,
  reviewed_at: "2026-10-24T16:00:00Z",
  version: 2,
  page_attested_by_membership_id: "m-consultant",
  page_attested_on: "2026-10-24",
  ...over,
});

const estimate = (over: Partial<EstimateRow> = {}): EstimateRow => ({
  id: "e1",
  source_url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/check-processing-times.html",
  application_type: "Synthetic application type",
  estimate_text: "Synthetic estimate",
  checked_on: "2026-10-23",
  page_retrieved_at: null,
  snapshot_sha256: null,
  status: "approved",
  entered_by_membership_id: "m-manager",
  reviewed_by_membership_id: "m-consultant",
  reviewed_at: "2026-10-24T13:00:00Z",
  created_at: "2026-10-23T15:00:00Z",
  version: 2,
  page_attested_by_membership_id: "m-consultant",
  page_attested_on: "2026-10-24",
  ...over,
});

function govCtx(over: Partial<GovernmentContext> = {}): GovernmentContext {
  return {
    organizationId: "org",
    matterId: "matter",
    stage: "government_processing",
    timezone: "America/Toronto",
    today: "2026-10-24",
    now: new Date("2026-10-24T18:00:00Z"),
    memberName,
    userName: () => "Daniel Ruiz",
    consultant: "Amara Osei",
    me: "Amara Osei",
    role: "licensed_consultant",
    licensed: true,
    representatives: [],
    firmName: "Synthetic Firm",
    ...over,
  };
}

function govRecords(over: Partial<GovernmentRecords> = {}): GovernmentRecords {
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
    documents: { total: 0, open: 0 },
    expiring: [],
    ...over,
  };
}

describe("page not captured by Casevoya, checked by <reviewer> on <date>", () => {
  it("is the attestation note, and nothing when there is no attestation", () => {
    expect(attestationNote(requirement(), memberName)).toMatch(NOT_CAPTURED);
    expect(attestationNote(requirement({ page_attested_on: null, page_attested_by_membership_id: null }), memberName)).toBeNull();
  });

  it("shows next to an official step, in place of “no page snapshot”; a snapshot still shows its hash", () => {
    expect(provenance(requirement(), longDay, memberName)).toContainEqual(expect.stringMatching(NOT_CAPTURED));
    expect(provenance(requirement({ page_attested_on: null, status: "pending_review" }), longDay, memberName)).toContain("no page snapshot");
    const captured = provenance(requirement({ snapshot_sha256: "c".repeat(64), page_attested_on: null }), longDay, memberName);
    expect(captured.some((part) => part.startsWith("snapshot sha256 cccc"))).toBe(true);
    expect(captured.join(" ")).not.toContain("not captured");
    // On the checklist card: the step and the channel name.
    const { card } = buildSubmissionChecklist(
      checklistInput({ requirements: [requirement(), requirement({ id: "r2", kind: "channel_name", label: "Synthetic portal name" })] }),
    );
    expect(card.steps[0].source.facts.join(", ")).toContain("page not captured by Casevoya, checked by Amara Osei on 24 Oct");
    expect(card.channel?.source?.facts.join(", ")).toContain("page not captured by Casevoya, checked by Amara Osei on 24 Oct");
  });

  it("shows next to an issuer, on the list and on a letter that names it", () => {
    expect(issuerSourceParts(issuer(), memberName)).toContainEqual(expect.stringMatching(NOT_CAPTURED));
    expect(issuerSourceParts(issuer({ page_attested_on: null, page_attested_by_membership_id: null, status: "pending_review" }), memberName)).toContain(
      "page not read by the server",
    );
    expect(letterIssuerParts("Synthetic Office", "i1", [issuer()], memberName)).toContainEqual(expect.stringMatching(NOT_CAPTURED));
    const list = issuerList({ organizationId: "org", today: "2026-10-24", issuers: [issuer()], canAdd: true, canReview: true, memberName });
    expect(list.rows[0].source).toContainEqual(expect.stringMatching(NOT_CAPTURED));
  });

  it("shows next to IRCC's estimate on the Government status page", () => {
    expect(estimateSource(estimate(), memberName)).toBe(
      "Source: canada.ca, checked 23 Oct 2026, page not captured by Casevoya, checked by Amara Osei on 24 Oct 2026",
    );
    expect(estimateSource(estimate({ page_attested_on: null, status: "pending_review" }), memberName)).toContain("page not captured");
    const page = buildGovernmentPage(govRecords({ estimates: [estimate()] }), govCtx());
    expect(page.rows.find((row) => row.item === "IRCC processing time")?.source).toContain("checked by Amara Osei on 24 Oct 2026");
  });
});

describe("Approve on an entry without a page capture asks for the reviewer's attestation", () => {
  it("official steps: Approve opens the attestation dialog, built from the dialog parts", () => {
    const { card, dialogs } = buildSubmissionChecklist(checklistInput({ requirements: [requirement({ status: "pending_review", page_attested_on: null, page_attested_by_membership_id: null })] }));
    expect(card.pending[0].approve).toMatchObject({ "data-sub": "attest-open", "data-id": "r1", "data-version": "2" });
    expect(dialogs.attest).toEqual({ wire: { "data-sub": "attest", "data-org": "org", "data-matter": "matter" }, today: "2026-10-24" });
    const html = renderToStaticMarkup(createElement(SubmissionChecklistDialogs, { data: dialogs }));
    expect(html).toContain('id="dSubAtt"');
    expect(html).toContain('class="dlg wide"');
    expect(html).toContain('<input type="date" max="2026-10-24" data-attest-on="" value="2026-10-24"/>');
    expect(html).toContain('<label class="check"');
    expect(html).toContain(ATTEST_LABEL);
    // With a snapshot: Approve is the plain review, and no attestation dialog.
    const captured = buildSubmissionChecklist(checklistInput({ requirements: [requirement({ status: "pending_review", snapshot_sha256: "c".repeat(64), page_attested_on: null })] }));
    expect(captured.card.pending[0].approve).toMatchObject({ "data-sub": "review", "data-decision": "approved" });
    expect(captured.dialogs.attest).toBeNull();
  });

  it("issuers: an unread pending issuer's row carries the attestation fields; a read one doesn't", () => {
    const list = issuerList({
      organizationId: "org",
      today: "2026-10-24",
      issuers: [
        issuer({ id: "i1", status: "pending_review", page_attested_on: null, page_attested_by_membership_id: null, version: 1 }),
        issuer({ id: "i2", name: "Read Office", status: "pending_review", snapshot_sha256: "a".repeat(64), retrieved_at: "2026-10-23T15:00:00Z", page_attested_on: null, version: 1 }),
      ],
      canAdd: true,
      canReview: true,
      memberName,
    });
    const unread = list.rows.find((row) => row.id === "i1");
    const read = list.rows.find((row) => row.id === "i2");
    expect(unread?.attest).toEqual({ today: "2026-10-24" });
    expect(read?.attest).toBeNull();
    const html = renderToStaticMarkup(createElement(IssuerList, { data: list, start: 0 }));
    expect(html.match(/data-attest=""/g)).toHaveLength(1);
    // A staff member who can't review sees no attestation.
    expect(issuerList({ organizationId: "org", today: "2026-10-24", issuers: [issuer({ status: "pending_review", page_attested_on: null })], canAdd: true, canReview: false }).rows[0].attest).toBeNull();
  });

  it("IRCC estimates: the review dialog asks for it only when the page wasn't captured", () => {
    const pending = estimate({ status: "pending_review", reviewed_by_membership_id: null, reviewed_at: null, page_attested_on: null, page_attested_by_membership_id: null });
    const page = buildGovernmentPage(govRecords({ estimates: [pending] }), govCtx());
    expect(page.dialogs?.review?.attest).toEqual({ today: "2026-10-24" });
    const html = renderToStaticMarkup(createElement(GovStatusDialogs, { data: page.dialogs! }));
    expect(html).toContain('id="dGovEstRev"');
    expect(html).toContain(ATTEST_LABEL);
    const captured = buildGovernmentPage(govRecords({ estimates: [{ ...pending, snapshot_sha256: "9".repeat(64), page_retrieved_at: "2026-10-23T15:00:00Z" }] }), govCtx());
    expect(captured.dialogs?.review?.attest).toBeNull();
  });

  it("reads the tick and the date, and refuses a missing tick or a future date", () => {
    expect(readAttestation(true, "2026-10-24", "2026-10-24")).toEqual({ openedOn: "2026-10-24" });
    expect(readAttestation(false, "2026-10-24", "2026-10-24")).toHaveProperty("error");
    expect(readAttestation(true, "", "2026-10-24")).toHaveProperty("error");
    expect(readAttestation(true, "2026-10-25", "2026-10-24")).toHaveProperty("error");
  });
});

describe("the database's refusals, in plain words, on every surface", () => {
  const MISSING = "Casevoya has no capture of this page: approving it needs your attestation that you opened the official page yourself and the entry matches it";
  const SELF = "you entered this yourself, so another licensed member of the firm approves it";
  const RANGE = "the date you opened the page must be between the day the entry was made and today";

  it("maps the attestation and self-approval refusals before the generic role refusal", () => {
    expect(attestationError(MISSING)).toContain("Tick that you opened the official page yourself");
    expect(attestationError(RANGE)).toContain("between the day the entry was made and today");
    const self = "You entered this yourself, so another licensed member of the firm approves it.";
    expect(attestationError(SELF)).toBe(self);
    expect(checklistError(SELF)).toBe(self);
    expect(letterError(SELF)).toBe(self);
    expect(provenanceError(SELF)).toBe(self);
    expect(checklistError(MISSING)).toContain("Tick that you opened");
    expect(provenanceError(MISSING)).toContain("Tick that you opened");
    expect(letterError(MISSING)).toContain("Tick that you opened");
  });
});
