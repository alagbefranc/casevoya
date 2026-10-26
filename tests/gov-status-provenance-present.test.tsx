import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LivePortal } from "@/components/portal/live";
import { SheetGovernment } from "@/components/sheet/designer/government";
import { homeView } from "@/modules/portal/home-present";
import type { PortalViewer } from "@/modules/portal/load";
import {
  clientRecordView,
  ESTIMATE_NOTE,
  isCanadaCaUrl,
  lastCheckedAt,
  provenanceError,
  SYNC_CLAIM,
  type EstimateRow,
} from "@/modules/government/status-provenance";
import { buildGovernmentPage, type GovernmentContext, type GovernmentRecords, type LetterRow } from "@/modules/sheet/government-present";

/** GOV-05: provenance on each status, Mark checked, Share with client, IRCC estimates, and no sync claims. */
const NOW = new Date("2026-10-18T14:00:00Z");

function ctx(over: Partial<GovernmentContext> = {}): GovernmentContext {
  return {
    organizationId: "org",
    matterId: "matter",
    stage: "government_processing",
    timezone: "America/Toronto",
    today: "2026-10-18",
    now: NOW,
    memberName: (id) => (id === "m-consultant" ? "Amara Osei" : id ? "Daniel Ruiz" : "Unassigned"),
    userName: (id) => (id ? "Daniel Ruiz" : "Someone at the firm"),
    consultant: "Amara Osei",
    me: "Daniel Ruiz",
    role: "case_manager",
    licensed: false,
    representatives: [],
    firmName: "Synthetic Firm",
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
    documents: { total: 0, open: 0 },
    expiring: [],
    ...over,
  };
}

function letter(over: Partial<LetterRow> = {}): LetterRow {
  return {
    id: "11111111-aaaa-4aaa-8aaa-111111111111",
    kind: "status_update",
    channel: "portal_message",
    received_on: "2026-10-12",
    document_date: null,
    action_requested: null,
    stated_deadline: null,
    evidence_version_id: "v-1",
    evidence_locator: null,
    verified_by_membership_id: "m-consultant",
    verified_at: "2026-10-13T15:00:00Z",
    shared_with_client_at: null,
    created_by: "u1",
    created_at: "2026-10-12T16:00:00Z",
    version: 2,
    ...over,
  };
}

function estimate(over: Partial<EstimateRow> = {}): EstimateRow {
  return {
    id: "e1",
    source_url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/check-processing-times.html",
    application_type: "Synthetic application type",
    estimate_text: "Synthetic estimate",
    checked_on: "2026-10-17",
    page_retrieved_at: null,
    snapshot_sha256: null,
    status: "pending_review",
    entered_by_membership_id: "m-manager",
    reviewed_by_membership_id: null,
    reviewed_at: null,
    created_at: "2026-10-17T15:00:00Z",
    version: 1,
    ...over,
  };
}

const statusRow = (page: ReturnType<typeof buildGovernmentPage>) => page.rows.find((row) => row.item === "Status update");

describe("GOV-05 each status's provenance", () => {
  it("shows source, recorder, evidence link, verified time and last checked, with Mark checked", () => {
    const page = buildGovernmentPage(records({ letters: [letter()] }), ctx());
    const row = statusRow(page);
    expect(row).toMatchObject({
      source: "Source: IRCC portal message",
      recordedBy: "Daniel Ruiz",
      evidenceOpen: { "data-doc-open": "v-1", "data-org": "org" },
      verified: "Amara Osei, 13 Oct 11:00",
      lastChecked: "Not checked yet",
      check: { "data-govs": "check", "data-org": "org", "data-matter": "matter", "data-id": letter().id },
    });
    // The Submission row is checked as the whole matter.
    expect(page.rows[0].check).toEqual({ "data-govs": "check", "data-org": "org", "data-matter": "matter" });
  });

  it("takes last checked from a check of this status or of the whole matter, whichever is later", () => {
    const id = letter().id;
    const checks = [
      { note: "n", checked_by_membership_id: "m", checked_at: "2026-10-16T13:00:00Z", correspondence_id: null },
      { note: "n", checked_by_membership_id: "m", checked_at: "2026-10-18T13:05:00Z", correspondence_id: id },
      { note: "n", checked_by_membership_id: "m", checked_at: "2026-10-18T13:30:00Z", correspondence_id: "other" },
    ];
    expect(lastCheckedAt(checks, id)).toBe("2026-10-18T13:05:00Z");
    expect(lastCheckedAt(checks, null)).toBe("2026-10-16T13:00:00Z");
    expect(lastCheckedAt([], id)).toBeNull();
    const page = buildGovernmentPage(records({ letters: [letter()], checks }), ctx());
    expect(statusRow(page)?.lastChecked).toBe("Today 09:05");
    expect(page.rows[0].lastChecked).toBe("16 Oct 09:00");
  });

  it("offers Mark checked to staff only", () => {
    const page = buildGovernmentPage(records({ letters: [letter()] }), ctx({ role: "finance_user" }));
    expect(statusRow(page)?.check).toBeNull();
    expect(page.rows[0].check).toBeNull();
  });
});

describe("GOV-05 Share with client", () => {
  it("previews exactly what the portal shows, to an owner or licensed consultant, for a verified status", () => {
    const page = buildGovernmentPage(records({ letters: [letter({ action_requested: "Synthetic action" })] }), ctx({ role: "licensed_consultant", licensed: true }));
    const row = statusRow(page);
    expect(row?.share).toEqual({ "data-open": "dGovShare-11111111" });
    const dialog = page.dialogs?.shares[0];
    expect(dialog?.wire).toEqual({ "data-govs": "share", "data-org": "org", "data-matter": "matter", "data-id": letter().id });
    const portal = clientRecordView({ kind: "status_update", received_on: "2026-10-12", action_requested: "Synthetic action", created_at: "2026-10-12T16:00:00Z" }, "Synthetic Firm", "America/Toronto");
    expect(dialog?.view).toEqual(portal);
    expect(portal).toEqual({ title: "Status update", lines: ["Received 12 Oct 2026", "What it asks: Synthetic action"], recorded: "Recorded by Synthetic Firm on 12 Oct 2026" });
  });

  it("is not offered to a case manager, before verification, or once shared", () => {
    expect(statusRow(buildGovernmentPage(records({ letters: [letter()] }), ctx()))?.share).toBeNull();
    expect(buildGovernmentPage(records({ letters: [letter()] }), ctx()).dialogs?.shares).toEqual([]);
    const unverified = buildGovernmentPage(records({ letters: [letter({ verified_at: null })] }), ctx({ role: "firm_owner" }));
    expect(statusRow(unverified)?.share).toBeNull();
    const shared = buildGovernmentPage(records({ letters: [letter({ shared_with_client_at: "2026-10-14T15:00:00Z" })] }), ctx({ role: "firm_owner" }));
    expect(statusRow(shared)).toMatchObject({ share: null, shared: "Shared with client 14 Oct 2026" });
  });

  it("dates the portal line in the firm's time zone", () => {
    // 01:30 UTC on 13 Oct is still 12 Oct in Toronto.
    const view = clientRecordView({ kind: "acknowledgement", received_on: "2026-10-12", action_requested: null, created_at: "2026-10-13T01:30:00Z" }, "Test Firm", "America/Toronto");
    expect(view.recorded).toBe("Recorded by Test Firm on 12 Oct 2026");
    expect(view.lines).toEqual(["Received 12 Oct 2026"]);
  });
});

describe("GOV-05 portal Home", () => {
  const person = { id: "p1", displayName: "Casey Nguyen", email: "casey@example.test", phone: null, isMinor: false, role: "applicant" };
  const viewer: PortalViewer = {
    organizationId: "00000000-0000-4000-8000-000000000001",
    organizationName: "Test Firm",
    organizationSlug: "test-firm",
    timezone: "America/Toronto",
    role: "client",
    person,
    matters: [{ id: "m1", title: "Work permit", stage: "government processing", onHold: false, reference: "EX-2026-0007" }],
    people: [person],
    grants: [],
    shares: [],
    prefs: null,
    sections: [],
  };
  const base = () =>
    homeView({ firmName: "Test Firm", personName: "Casey Nguyen", timezone: "America/Toronto", now: NOW, matter: viewer.matters[0], consultant: null, tasks: [], documents: [], invoices: [], messages: null });

  it("lists shared statuses as recorded by the firm, with the same words as the staff preview", () => {
    const record = clientRecordView({ kind: "status_update", received_on: "2026-10-12", action_requested: null, created_at: "2026-10-12T16:00:00Z" }, "Test Firm", "America/Toronto");
    const html = renderToStaticMarkup(createElement(LivePortal, { page: "home", viewer, home: { ...base(), government: [record] } }));
    expect(html).toContain("Updates from Test Firm");
    expect(html).toContain("Status update");
    expect(html).toContain("Received 12 Oct 2026");
    expect(html).toContain("Recorded by Test Firm on 12 Oct 2026");
    expect(html).toContain("There’s no live link to IRCC");
  });

  it("shows no updates panel when nothing was shared", () => {
    const html = renderToStaticMarkup(createElement(LivePortal, { page: "home", viewer, home: base() }));
    expect(html).not.toContain("Updates from Test Firm");
  });
});

describe("GOV-05 IRCC processing-time estimates", () => {
  it("shows nothing until an estimate is entered, and Add IRCC estimate to staff", () => {
    const page = buildGovernmentPage(records(), ctx());
    expect(page.rows.some((row) => row.item === "IRCC processing time")).toBe(false);
    expect(page.estimate).toEqual({ "data-open": "dGovEst" });
    expect(page.dialogs?.estimate?.url).toBe("https://www.canada.ca/en/immigration-refugees-citizenship/services/application/check-processing-times.html");
    expect(page.dialogs?.estimate?.today).toBe("2026-10-18");
    expect(buildGovernmentPage(records(), ctx({ role: "finance_user" })).estimate).toBeNull();
  });

  it("holds a pending estimate for a licensed member and never shows its value as IRCC's", () => {
    const pending = buildGovernmentPage(records({ estimates: [estimate()] }), ctx());
    const row = pending.rows.find((item) => item.item === "IRCC processing time");
    expect(row?.status).toEqual({ tone: "chg", label: "Waiting for licensed review" });
    expect(row?.review).toBeNull();
    expect(row?.source).toBe("Source: canada.ca, checked 17 Oct 2026, page not captured");
    const licensed = buildGovernmentPage(records({ estimates: [estimate()] }), ctx({ role: "licensed_consultant", licensed: true }));
    expect(licensed.rows.find((item) => item.item === "IRCC processing time")?.review).toEqual({ "data-open": "dGovEstRev" });
    expect(licensed.dialogs?.review?.approve).toEqual({ "data-govs": "estimate-review", "data-org": "org", "data-matter": "matter", "data-id": "e1", "data-version": "1", "data-decision": "approved" });
    expect(licensed.dialogs?.review?.facts).toContainEqual(["Date checked", "17 Oct 2026"]);
  });

  it("shows an approved estimate next to the submission status, labelled as IRCC's estimate with the date checked", () => {
    const approved = estimate({ status: "approved", reviewed_by_membership_id: "m-consultant", reviewed_at: "2026-10-18T13:00:00Z", snapshot_sha256: "9be2".padEnd(60, "0") + "11c4", page_retrieved_at: "2026-10-17T15:00:00Z" });
    const page = buildGovernmentPage(records({ estimates: [approved] }), ctx());
    expect(page.rows[1]).toMatchObject({
      item: "IRCC processing time",
      status: { tone: "blue", label: "Synthetic estimate", detail: "IRCC’s estimate" },
      evidence: `Synthetic application type. ${ESTIMATE_NOTE}.`,
      evidenceHref: approved.source_url,
      source: "Source: canada.ca, checked 17 Oct 2026, page captured (sha256 9be2…11c4)",
      verified: "Amara Osei, Today 09:00",
      lastChecked: "17 Oct 2026",
    });
    expect(ESTIMATE_NOTE).toBe("IRCC’s estimate, not a maximum or a guarantee");
  });

  it("accepts only an https canada.ca page, as the database does", () => {
    expect(isCanadaCaUrl("https://www.canada.ca/en/immigration-refugees-citizenship/services/application/check-processing-times.html")).toBe(true);
    expect(isCanadaCaUrl("https://ircc.canada.ca/english/information/times/index.asp")).toBe(true);
    expect(isCanadaCaUrl("http://www.canada.ca/x")).toBe(false);
    expect(isCanadaCaUrl("https://canada.ca.example.com/x")).toBe(false);
    expect(isCanadaCaUrl("https://laws-lois.justice.gc.ca/eng/acts/I-2.5/")).toBe(false);
    expect(provenanceError("the estimate must come from IRCC's official processing-times page on canada.ca")).toBe("Use IRCC’s processing-times page on canada.ca.");
    expect(provenanceError("some database detail")).toBe("That couldn’t be saved.");
  });
});

describe("GOV-05 rendering", () => {
  it("renders the live controls in the Designer's own classes", () => {
    const page = buildGovernmentPage(
      records({ letters: [letter()], estimates: [estimate()] }),
      ctx({ role: "licensed_consultant", licensed: true }),
    );
    const html = renderToStaticMarkup(createElement(SheetGovernment, { data: page }));
    expect(html).toContain('data-govs="check"');
    expect(html).toContain("Mark checked");
    expect(html).toContain('data-open="dGovShare-11111111"');
    expect(html).toContain('id="dGovShare-11111111"');
    expect(html).toContain("Recorded by Synthetic Firm on 12 Oct 2026");
    expect(html).toContain('data-doc-open="v-1"');
    expect(html).toContain("Add IRCC estimate");
    expect(html).toContain('id="dGovEst"');
    expect(html).toContain('id="dGovEstRev"');
    expect(html).toContain("not a maximum or a guarantee");
  });
});

describe("GOV-05 no automatic sync or real-time wording", () => {
  it("recognises the claims it guards against", () => {
    for (const claim of ["Real-time IRCC status", "Automatically synced", "auto-sync", "Synced with IRCC", "tracks your application automatically"]) {
      expect(claim).toMatch(SYNC_CLAIM);
    }
    expect("This is a record kept by the firm, not a live feed.").not.toMatch(SYNC_CLAIM);
  });

  it("finds none in staff or portal government copy", () => {
    const files = [
      "src/components/sheet/designer/government.tsx",
      "src/components/sheet/designer/gov-status-dialogs.tsx",
      "src/components/sheet/designer/matter-government.tsx",
      "src/components/sheet/markup/government.tsx",
      "src/components/sheet/gov-acts.ts",
      "src/components/sheet/gov-status-acts.ts",
      "src/modules/sheet/government-present.ts",
      "src/modules/sheet/government-load.ts",
      "src/modules/sheet/gov-status-present.ts",
      "src/modules/government/present.ts",
      "src/modules/government/status-provenance.ts",
      "src/components/portal/live.tsx",
      "src/components/portal/markup/portal.tsx",
      "src/modules/portal/home-present.ts",
      "src/modules/portal-policies/defaults.ts",
    ];
    for (const file of files) {
      const text = readFileSync(path.join(process.cwd(), file), "utf8").replace(/export const SYNC_CLAIM[^\n]*\n/, "");
      expect({ file, hit: text.match(SYNC_CLAIM)?.[0] ?? null }).toEqual({ file, hit: null });
    }
  });
});
