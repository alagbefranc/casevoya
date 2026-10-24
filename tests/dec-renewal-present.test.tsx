import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RenewalPanel } from "@/components/sheet/designer/matter-renewal";
import { MatterDecisionsLive, type MatterDecisionsData } from "@/components/sheet/designer/matter-government";
import { currentFee, feeLine, portalRenewals, reminderBasis, renewalError, timingFacts } from "@/modules/renewals/present";
import { buildRenewalPanel, type FeeRow, type RenewalInput, type RenewalRow, type TimingRow } from "@/modules/sheet/renewal-present";

/**
 * DEC-02 renewal presentation: no default reminder date (an approved IRCC timing or the firm's
 * choice, labelled so), the renewal reminder offered only when the client's contact choices allow
 * it (the reason shown when not), IRCC timings and fees shown with their source, and a fee shown
 * only while it is in the approved fee list. Synthetic values only (no IRCC content).
 */
const PAGE = "https://www.canada.ca/en/synthetic-renewal-page.html#synthetic-section";
const FEES = "https://ircc.canada.ca/english/information/fees/fees.asp#synthetic";
const HASH = "a".repeat(64);

const renewal = (over: Partial<RenewalRow> = {}): RenewalRow => ({
  id: "r1",
  decision_id: "d1",
  document_label: "Synthetic permit",
  expires_on: "2027-03-12",
  document_version_id: null,
  remind_on: "2027-01-12",
  timing_id: null,
  task_id: "t1",
  owner_membership_id: "m1",
  recorded_by_membership_id: "m1",
  client_person_id: null,
  service_scope: null,
  fee_section: null,
  fee_group: null,
  fee_name: null,
  lead_id: null,
  reminder_set_at: null,
  reminder_set_by_membership_id: null,
  cancelled_at: null,
  cancel_reason: null,
  created_at: "2026-10-24T14:00:00Z",
  version: 1,
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
  snapshot_sha256: HASH,
  status: "approved",
  version: 2,
  ...over,
});

const fee = (over: Partial<FeeRow> = {}): FeeRow => ({
  id: "f1",
  section: "Synthetic section",
  fee_group: null,
  name: "Synthetic renewal fee",
  amount_cents: 12_345,
  currency: "CAD",
  source_url: FEES,
  retrieved_at: "2026-10-24T15:00:00Z",
  snapshot_sha256: HASH,
  status: "approved",
  reviewed_at: "2026-10-24T16:00:00Z",
  ...over,
});

const input = (over: Partial<RenewalInput> = {}): RenewalInput => ({
  organizationId: "org",
  role: "case_manager",
  licensed: false,
  today: "2026-10-24",
  timezone: "America/Toronto",
  decisionId: "d1",
  sample: false,
  closed: false,
  program: null,
  renewals: [],
  tasks: new Map([["t1", { status: "open", due_on: "2027-01-12" }]]),
  timings: [],
  fees: [],
  contact: { allowed: true, reason: "Synthetic Client chose “Remind me before a deadline” in their portal contact choices.", name: "Synthetic Client" },
  files: [],
  memberName: () => "Synthetic Staff",
  ...over,
});

describe("DEC-02 Expiry and renewal card", () => {
  it("labels a reminder date the firm chose, and offers Set renewal reminder only when the client opted in", () => {
    const panel = buildRenewalPanel(input({ renewals: [renewal()] }));
    expect(panel.rows[0].title).toBe("Synthetic permit expires 12 Mar 2027");
    expect(panel.rows[0].basis).toEqual({ text: "Reminder date chosen by the firm", source: null });
    expect(panel.rows[0].set).toMatchObject({ "data-ren": "set-open", "data-id": "r1", "data-version": "1" });
    expect(panel.dialogs.set?.client).toBe("Synthetic Client");
    expect(panel.timingsEmpty).toMatch(/every reminder date is the firm’s choice/);

    const out = buildRenewalPanel(
      input({
        renewals: [renewal()],
        contact: { allowed: false, reason: "Synthetic Client has “Remind me before a deadline” turned off in their portal contact choices.", name: "Synthetic Client" },
      }),
    );
    expect(out.rows[0].set).toBeNull();
    expect(out.dialogs.set).toBeNull();
    expect(out.contact).toEqual({ allowed: false, text: "Synthetic Client has “Remind me before a deadline” turned off in their portal contact choices." });
    const html = renderToStaticMarkup(createElement(RenewalPanel, { data: out }));
    expect(html).toContain("turned off in their portal contact choices");
    expect(html).not.toContain("Set renewal reminder");

    // A sample matter and an unreadable contact state say so and offer nothing.
    expect(buildRenewalPanel(input({ renewals: [renewal()], sample: true })).rows[0].set).toBeNull();
    expect(buildRenewalPanel(input({ sample: true })).contact.text).toMatch(/sample matter/);
    expect(buildRenewalPanel(input({ contact: null })).contact.text).toMatch(/couldn’t be read/);
  });

  it("shows an IRCC timing with its source and offers only approved timings that state days", () => {
    const approved = timing();
    const numberless = timing({ id: "tm2", lead_days: null, timing_text: "Synthetic words without a number" });
    const pending = timing({ id: "tm3", status: "pending_review", snapshot_sha256: null, version: 1 });
    const panel = buildRenewalPanel(input({ renewals: [renewal({ timing_id: "tm1", remind_on: "2027-01-26" })], timings: [approved, numberless, pending], licensed: true, role: "licensed_consultant" }));
    expect(panel.rows[0].basis.text).toBe("Reminder date from IRCC’s timing (45 days before expiry): “Synthetic timing words”");
    expect(panel.rows[0].basis.source).toEqual({ href: PAGE, text: "www.canada.ca/en/synthetic-renewal-page.html#synthetic-section", facts: ["checked 20 Oct 2026", "sha256 aaaaaaaaaa…"] });
    expect(panel.dialogs.expiry?.timings.map((option) => option.value)).toEqual(["tm1"]);
    expect(panel.timings).toHaveLength(2);
    expect(panel.pending[0]).toMatchObject({ badge: { tone: "bad", label: "No page snapshot" }, approve: null });
    expect(panel.pending[0].reject).toMatchObject({ "data-ren": "reject-open", "data-id": "tm3" });
    // A program's timing is offered only on a matter of that program.
    const other = buildRenewalPanel(input({ timings: [timing({ program_key: "synthetic_program" })] }));
    expect(other.dialogs.expiry?.timings).toEqual([]);
    expect(timingFacts({ ...approved, form_number: "IMM 0000", form_modified_on: "2026-01-02", current_to: "2026-10-01" })).toEqual([
      "IMM 0000, date modified 2 Jan 2026",
      "checked 20 Oct 2026",
      "current to 1 Oct 2026",
      "sha256 aaaaaaaaaa…",
    ]);
  });

  it("shows a fee only while it is in the approved IRCC fee list, with its retrieval date", () => {
    const set = renewal({
      client_person_id: "p1",
      service_scope: "Synthetic renewal application",
      fee_section: "Synthetic section",
      fee_group: null,
      fee_name: "Synthetic renewal fee",
      lead_id: "l1",
      reminder_set_at: "2026-10-24T18:00:00Z",
      reminder_set_by_membership_id: "m1",
      version: 2,
    });
    const shown = buildRenewalPanel(input({ renewals: [set], fees: [fee()] }));
    expect(shown.rows[0].fee).toEqual({ text: "IRCC fee: Synthetic renewal fee: CAD 123.45 (IRCC fee list, retrieved 24 Oct 2026)", href: FEES });
    expect(shown.rows[0].lead).toEqual({ href: "/sheet/lead?id=l1", label: "Open the renewal lead" });
    expect(shown.rows[0].badge).toEqual({ tone: "ok", label: "Client reminder set" });
    expect(shown.rows[0].set).toBeNull();
    const gone = buildRenewalPanel(input({ renewals: [set], fees: [fee({ status: "superseded" })] }));
    expect(gone.rows[0].fee?.text).toMatch(/not in the approved IRCC fee list now, so the client sees no fee/);
    expect(currentFee([fee({ name: "Other" })], set)).toBeNull();
    expect(feeLine(null, "America/Toronto")).toBeNull();
  });

  it("is rendered on the Decisions tab after the decision, from the Designer's parts", () => {
    const data: MatterDecisionsData = {
      decision: {
        outcome: "approved",
        heading: "Approved",
        tint: { art: "post-decision", title: "Follow-ups after the decision", copy: "Synthetic copy" },
        badge: { tone: "ok", label: "Confirmed" },
        followUps: [],
      },
      letter: true,
      letters: [],
      renewal: buildRenewalPanel(input({ renewals: [renewal()] })),
    };
    const html = renderToStaticMarkup(createElement(MatterDecisionsLive, { data }));
    expect(html).toContain('id="renewalPanel"');
    expect(html).toContain('class="panel rv"');
    expect(html).toContain('id="dRenExp"');
    expect(html).toContain('id="dRenSet"');
    expect(html).toContain("Reminder date chosen by the firm");
  });
});

describe("DEC-02 portal renewal reminders and refusals", () => {
  it("shows the client's reminder in plain words, with the fee and timing sources only when present", () => {
    const views = portalRenewals(
      [
        {
          id: "r1",
          document_label: "Synthetic permit",
          expires_on: "2027-03-12",
          remind_on: "2027-01-12",
          service_scope: "Synthetic renewal application",
          timing: null,
          fee: { name: "Synthetic renewal fee", amount_cents: 12_345, currency: "CAD", source_url: FEES, retrieved_at: "2026-10-24T15:00:00Z", snapshot_sha256: HASH },
        },
        { nonsense: true },
      ],
      "Synthetic Firm",
      "America/Toronto",
    );
    expect(views).toEqual([
      {
        title: "Renewal reminder: Synthetic permit",
        lines: [
          "Expires 12 Mar 2027, as shown on your document.",
          "Synthetic Firm has a reminder to review your renewal on 12 Jan 2027.",
          "What Synthetic Firm would do for the renewal: Synthetic renewal application",
          "This is a reminder only. It isn’t an invoice.",
        ],
        timing: null,
        fee: { text: "Government fee: Synthetic renewal fee: CAD 123.45 (IRCC fee list, retrieved 24 Oct 2026)", href: FEES },
      },
    ]);
    expect(portalRenewals(null, "Synthetic Firm", "UTC")).toEqual([]);
  });

  it("keeps the contact-choice reason in the refusal, and words the others plainly", () => {
    expect(renewalError("renewal reminder refused: Synthetic Client hasn't saved contact choices in the portal, so they haven't asked for reminders.")).toBe(
      "Renewal reminder refused. Synthetic Client hasn't saved contact choices in the portal, so they haven't asked for reminders.",
    );
    expect(renewalError("choose the reminder date (the firm's choice); no default is set")).toMatch(/no date is set for you/);
    expect(renewalError("only a fee from the approved IRCC fee list can be shown to the client")).toMatch(/approved IRCC fee list/);
    expect(reminderBasis(null)).toBe("Reminder date chosen by the firm");
  });
});
