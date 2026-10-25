import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrivacyDialogs, SheetPrivacy } from "@/components/sheet/designer/privacy";
import { CAPTURED_PROVISIONS } from "@/modules/compliance/privacy-official";
import { assemblePrivacyRecords, WITHHELD, type PackageItem } from "@/modules/compliance/privacy-package";
import { presentPrivacy, privacyDialogs, type PrivacyContext, type PrivacyRequestRow } from "@/modules/compliance/privacy-present";
import { privacyResponseError } from "@/modules/compliance/privacy-response-format";
import { foundPanel, limitsPanel, responseActions, responseRows, type PrivacyExtras, type TimeLimitRow } from "@/modules/compliance/privacy-response-present";
import { portalPrivacyNotices } from "@/modules/portal/privacy-notices";
import { federalOfficialUrl } from "@/modules/submissions/official-page";

/** SEC-06 presentation: no legal period without an approved official source, honest package and proof states. */

const CTX: PrivacyContext = {
  organizationId: "org",
  timezone: "UTC",
  today: "2026-10-24",
  userName: () => "Staff member",
  memberName: (id) => (id === "m-lic" ? "Lee Licensed" : "Case Manager"),
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
    identity_verified_at: "2026-10-11T10:00:00Z",
    identity_method: "Video call",
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

function limit(overrides: Partial<TimeLimitRow> = {}): TimeLimitRow {
  return {
    id: "l1",
    kind: "response",
    law_name: "Synthetic Privacy Act",
    provision_text: "Synthetic provision.",
    days: 30,
    source_url: "https://laws-lois.justice.gc.ca/eng/acts/X/FullText.html#s-1",
    source_section: "s. 1(1)",
    checked_on: "2026-10-24",
    current_to: "2026-09-30",
    snapshot_sha256: "a".repeat(64),
    status: "approved",
    reviewed_by_membership_id: "m-lic",
    reviewed_at: "2026-10-24T12:00:00Z",
    review_note: null,
    page_attested_by_membership_id: null,
    page_attested_on: null,
    version: 2,
    ...overrides,
  };
}

const NONE: PrivacyExtras = { limits: [], items: [], responses: [], delivery: null, hasPortal: true, canReview: false };

describe("deadline and delivery", () => {
  it("shows no legal time limit until one is approved, and labels the firm's own extension", () => {
    const rows = responseRows(request(), NONE, CTX);
    expect(rows.map((row) => row.term)).toEqual(["Extension", "Package", "Delivery"]);
    expect(JSON.stringify(rows)).not.toMatch(/Legal|30 days/);
    const pending = responseRows(request(), { ...NONE, limits: [limit({ status: "pending_review", reviewed_by_membership_id: null, reviewed_at: null })] }, CTX);
    expect(pending.map((row) => row.term)).not.toContain("Legal time limit");

    const approved = responseRows(request(), { ...NONE, limits: [limit()] }, CTX);
    expect(approved[0]).toEqual({ term: "Legal time limit", value: ["30 days from receipt", "9 Nov 2026", "Synthetic Privacy Act, s. 1(1)", "current to 30 Sep 2026"] });

    const firm = responseRows(
      request({ extended_at: "2026-10-20T10:00:00Z", extended_due_on: "2026-12-01", extension_basis: "firm", extension_reason: "Large file", extension_notice_channel: "portal", extension_notice_seen_at: "2026-10-21T09:00:00Z" }),
      NONE,
      CTX,
    );
    expect(firm[0]).toEqual({ term: "Extension", value: ["To 1 Dec 2026", "set by the firm", "Large file", "seen in the portal 21 Oct"] });
    const official = responseRows(
      request({ extended_at: "2026-10-20T10:00:00Z", extended_due_on: "2026-12-01", extension_basis: "official", extension_time_limit_id: "l2", extension_reason: "Consultations", extension_notice_channel: "other", extension_notice_method: "Letter", extension_notice_late: true }),
      { ...NONE, limits: [limit({ id: "l2", kind: "extension" })] },
      CTX,
    );
    expect(official[0].value).toEqual(["To 1 Dec 2026", "Synthetic Privacy Act, s. 1(1)", "Consultations", "told by Letter", "notice after the original time limit"]);
  });

  it("shows the package, the delivery and the download proof", () => {
    const responses = [
      { id: "x1", request_id: "r1", status: "ready", sha256: "b".repeat(64), byte_size: 100, file_count: 5, record_count: 9, withheld_count: 1, ready_at: "2026-10-22T10:00:00Z", requested_at: "2026-10-22T09:59:00Z", failed_reason: null },
    ];
    const ready = responseRows(request({ redaction_at: "2026-10-21T10:00:00Z" }), { ...NONE, responses }, CTX);
    expect(ready.find((row) => row.term === "Package")?.value).toEqual(["5 files", "1 withheld", "SHA-256 bbbbbbbbbbbb…", "built 22 Oct"]);
    const delivery = { id: "d1", request_id: "r1", response_id: "x1", delivered_at: "2026-10-23T10:00:00Z", expires_at: "2026-11-22T10:00:00Z", sha256: "b".repeat(64), download_count: 0, first_downloaded_at: null, last_downloaded_at: null };
    const waiting = responseRows(request({ closed_at: "2026-10-23T10:00:00Z", outcome: "fulfilled" }), { ...NONE, responses, delivery }, CTX);
    expect(waiting.find((row) => row.term === "Proof")?.value).toEqual(["Not downloaded yet", "SHA-256 bbbbbbbbbbbb…"]);
    const downloaded = responseRows(request({ closed_at: "2026-10-23T10:00:00Z" }), { ...NONE, responses, delivery: { ...delivery, download_count: 2, first_downloaded_at: "2026-10-24T08:00:00Z", last_downloaded_at: "2026-10-24T09:00:00Z" } }, CTX);
    expect(downloaded.find((row) => row.term === "Proof")?.value).toEqual(["Downloaded 2 times", "first 24 Oct 2026", "SHA-256 bbbbbbbbbbbb…"]);
    const offline = responseRows(request(), { ...NONE, hasPortal: false }, CTX);
    expect(offline.find((row) => row.term === "Delivery")?.value).toEqual(["They have no portal login", "deliver another way and close the request"]);
  });

  it("offers each step only when the database would take it", () => {
    const labels = (row: PrivacyRequestRow, extras: PrivacyExtras = NONE) => responseActions(row, extras, "org").map((action) => action.label);
    expect(labels(request({ identity_verified_at: null }))).toEqual(["Extend due date"]);
    expect(labels(request())).toEqual(["Search their records", "Extend due date"]);
    expect(labels(request({ person_id: null }))).toEqual(["Extend due date"]);
    expect(labels(request({ redaction_at: "2026-10-21T10:00:00Z", extended_at: "x", extended_due_on: "2026-12-01" }))).toEqual(["Build response package"]);
    const ready = { ...NONE, responses: [{ id: "x1", request_id: "r1", status: "ready", sha256: "b".repeat(64), byte_size: 1, file_count: 1, record_count: 1, withheld_count: 0, ready_at: "2026-10-22T10:00:00Z", requested_at: "2026-10-22T10:00:00Z", failed_reason: null }] };
    expect(labels(request({ redaction_at: "x", reviewed_at: "y", extended_at: "x" }), ready)).toEqual(["Build again", "Preview package", "Deliver through the portal"]);
    expect(labels(request({ redaction_at: "x", reviewed_at: "y", extended_at: "x" }), { ...ready, hasPortal: false })).toEqual(["Build again", "Preview package"]);
    expect(labels(request({ kind: "deletion" }))).toEqual([]);
    expect(labels(request({ closed_at: "z" }))).toEqual([]);
    const actions = responseActions(request(), NONE, "org");
    expect(actions[0].attrs).toEqual({ "data-privacy-scope": "r1", "data-org": "org" });
  });

  it("keeps the page as it was without the SEC-06 data, and adds it when loaded", () => {
    const plain = presentPrivacy({ ctx: CTX, rows: [request()], lines: [], consents: null, kept: null });
    expect(plain.page.limits).toBeUndefined();
    expect(plain.page.selected?.found).toBeUndefined();
    const live = presentPrivacy({ ctx: CTX, rows: [request({ due_on: "2026-10-31", target_days: 21, extended_due_on: "2026-11-20", extended_at: "x" })], lines: [], consents: null, kept: null, extras: NONE });
    expect(live.page.rows?.[0].due).toBe("20 Nov 2026");
    expect(live.page.limits?.empty).toMatch(/firm’s own until a licensed member approves/);
    expect(live.header.actions.map((action) => action.label)).toEqual(["Add legal time limit", "Record a request"]);
    const dialogs = privacyDialogs({ ctx: CTX, selectedRow: live.selectedRow, record: null, consents: null, settingsDays: null, extras: { ...NONE, limits: [limit({ id: "ext", kind: "extension" })] }, captured: [["k", "Captured"]] });
    expect(dialogs.response?.extend).toBeNull();
    const open = privacyDialogs({ ctx: CTX, selectedRow: request(), record: null, consents: null, settingsDays: null, extras: { ...NONE, limits: [limit({ id: "ext", kind: "extension" })] } });
    expect(open.response?.extend?.bases).toEqual([
      ["firm", "Set by the firm"],
      ["ext", "Synthetic Privacy Act, s. 1(1) (up to 30 days)"],
    ]);
  });
});

describe("records found and legal time limits panels", () => {
  it("lists each record with what is withheld and why, editable until the redaction step", () => {
    const items = [
      { id: "i1", request_id: "r1", source: "person", source_id: "p1", label: "Client record: Dana", fields: ["email", "display_name"], decision: "redact", withheld_fields: ["email"], third_party: "Spouse", reason: "Spouse’s email", decided_by: "u" },
      { id: "i2", request_id: "r1", source: "matter", source_id: "m1", label: "Matter MI-1", fields: ["title"], decision: "include", withheld_fields: [], third_party: null, reason: null, decided_by: null },
    ];
    const panel = foundPanel(request({ scope_at: "x" }), items, true)!;
    expect(panel.rows[0].cells).toEqual([{ text: "Client record: Dana" }, { text: "Client record" }, { text: "email" }, { text: "Spouse’s email" }, { badge: { tone: "chg", label: "Fields withheld" } }]);
    expect(panel.rows[0].attrs).toMatchObject({ "data-item-edit": "i1", "data-fields": "email,display_name", "data-withheld": "email", "data-party": "Spouse" });
    expect(foundPanel(request({ scope_at: "x" }), items, false)!.rows[0].attrs).toBeUndefined();
    expect(foundPanel(request({ kind: "deletion" }), items, true)).toBeNull();
    // The third party's name is never in the panel's visible cells.
    expect(JSON.stringify(panel.rows.map((row) => row.cells))).not.toContain("Spouse\"");
  });

  it("shows each limit's source, current-to date, capture or attestation, and reviewer", () => {
    const panel = limitsPanel([limit(), limit({ id: "l2", snapshot_sha256: null, page_attested_by_membership_id: "m-lic", page_attested_on: "2026-10-24" }), limit({ id: "l3", status: "pending_review", reviewed_by_membership_id: null })], true, CTX);
    expect(panel.rows[0].cells[2]).toEqual({ text: ["https://laws-lois.justice.gc.ca/eng/acts/X/FullText.html#s-1", "current to 30 Sep 2026"] });
    expect(panel.rows[0].cells[3]).toEqual({ text: ["24 Oct 2026", "page captured, SHA-256 aaaaaaaaaaaa…"] });
    expect(panel.rows[1].cells[3]).toEqual({ text: ["24 Oct 2026", "page not captured by Casevoya, checked by Lee Licensed on 24 Oct 2026"] });
    expect(panel.rows[0].cells[4]).toEqual({ badge: { tone: "ok", label: "Approved", detail: "Lee Licensed" } });
    expect(panel.rows[2].attrs).toMatchObject({ "data-limit-review": "l3", "data-status": "pending_review", "data-captured": "1" });
    expect(limitsPanel([limit()], false, CTX).rows[0].attrs).toBeUndefined();
  });
});

describe("response package contents", () => {
  it("leaves withheld records out with the reason, and replaces withheld fields", () => {
    const items: PackageItem[] = [
      { id: "i1", source: "person", source_id: "p1", label: "Client record", decision: "redact", withheld_fields: ["email"], reason: "Spouse’s email" },
      { id: "i2", source: "matter", source_id: "m1", label: "Matter MI-1", decision: "withhold", withheld_fields: [], reason: "About the sponsor only" },
      { id: "i3", source: "intake_response", source_id: "f1", label: "Intake form", decision: "redact", withheld_fields: ["spouse_name"], reason: "Spouse" },
    ];
    const rows = new Map([
      ["i1", { person: [{ id: "p1", display_name: "Dana", email: "spouse@example.test" }] }],
      ["i3", { intake_response: [{ id: "f1", status: "submitted" }], intake_answer: [{ field_key: "spouse_name", raw_value: "Sam" }, { field_key: "own_name", raw_value: "Dana" }] }],
    ]);
    const out = assemblePrivacyRecords(items, rows);
    const person = out.records.find((set) => set.source === "person")!;
    expect(person.rows).toEqual([{ id: "p1", display_name: "Dana", email: WITHHELD }]);
    expect(out.records.find((set) => set.source === "intake_answer")!.rows).toEqual([{ field_key: "spouse_name", raw_value: WITHHELD }, { field_key: "own_name", raw_value: "Dana" }]);
    expect(out.records.find((set) => set.source === "matter")).toBeUndefined();
    expect(out.excluded).toEqual([{ path: "records/matters.json", source: "matter", sourceId: "m1", reason: "Withheld: About the sponsor only" }]);
    expect(out.records.at(-1)).toEqual({
      path: "withheld.json",
      source: "withheld",
      rows: [
        { record: "Client record", reason: "email withheld: Spouse’s email" },
        { record: "Matter MI-1", reason: "About the sponsor only" },
        { record: "Intake form", reason: "spouse_name withheld: Spouse" },
      ],
    });
  });
});

describe("portal notices", () => {
  it("tells the person about an extension and their records, never after they no longer apply", () => {
    const now = new Date("2026-10-24T12:00:00Z");
    const notices = portalPrivacyNotices(
      [
        { id: "r1", reference: "PR-001", extended_due_on: "2026-12-01", extension_basis: "official", extension_reason: "Consultations", extension_recourse: "You may complain to the regulator.", law_name: "Synthetic Act", source_section: "s. 1", current_to: "2026-09-30" },
        { id: "r2", reference: "PR-002", extended_due_on: "2026-12-01", extension_basis: "firm", extension_reason: "Large file." },
        { id: "r3", reference: "PR-003", extended_due_on: "2026-12-01", closed_at: "2026-10-20T00:00:00Z" },
        { id: "r4", reference: "PR-004", delivery_id: "d4", expires_at: "2026-11-20T00:00:00Z", sha256: "c".repeat(64), file_count: 3 },
        { id: "r5", reference: "PR-005", delivery_id: "d5", expires_at: "2026-10-01T00:00:00Z", sha256: "c".repeat(64) },
      ],
      "Synthetic Firm",
      "UTC",
      now,
    );
    expect(notices.map((notice) => notice.id)).toEqual(["r1", "r2", "d4"]);
    expect(notices[0].body).toBe("Synthetic Firm will respond by 1 Dec 2026. Why: Consultations. Synthetic Firm extended it under Synthetic Act, s. 1 (current to 30 Sep 2026). You may complain to the regulator.");
    expect(notices[1].body).toBe("Synthetic Firm will respond by 1 Dec 2026. Why: Large file.");
    expect(notices[2]).toMatchObject({ download: { deliveryId: "d4" }, title: "Your privacy request PR-004: your records are ready" });
    expect(notices[2].body).toContain("Download them by 20 Nov 2026. 3 files.");
  });
});

describe("official content and refusals", () => {
  it("captured provisions carry an official link with its section, the current-to date, and days only when stated", () => {
    for (const provision of CAPTURED_PROVISIONS) {
      expect(federalOfficialUrl(provision.sourceUrl)).toBe(true);
      expect(provision.sourceUrl).toContain("#s-8");
      expect(provision.currentTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(provision.pageSha256).toMatch(/^[0-9a-f]{64}$/);
      if (provision.days !== null) expect(provision.provisionText).toMatch(/thirty days/);
    }
    expect(CAPTURED_PROVISIONS.find((provision) => provision.section === "s. 8(4)(b)")?.days).toBeNull();
  });

  it("SEC-06 dialogs and panels are built from the design system's dialog and panel parts", () => {
    const html = renderToStaticMarkup(
      createElement(PrivacyDialogs, {
        data: {
          organizationId: "org",
          record: null,
          step: null,
          redaction: null,
          close: null,
          settings: null,
          response: {
            extend: { requestId: "r1", reference: "PR-001", bases: [["firm", "Set by the firm"]], hasPortal: false },
            item: { requestId: "r1", reference: "PR-001" },
            deliver: { requestId: "r1", responseId: "x1", reference: "PR-001", withheld: 1 },
            limit: { today: "24/10/2026", captured: [["pipeda-8-3", "PIPEDA s. 8(3)"]] },
            limitReview: true,
          },
        },
      }),
    );
    for (const id of ["dlgPExt", "dlgPItem", "dlgPDel", "dlgPTL", "dlgPTLR"]) expect(html).toContain(`<dialog class="dlg" id="${id}"`);
    expect(html).toContain('id="peM"');
    expect(html).toContain('<select class="sel" id="piF" multiple=""></select>');
    expect(html).toContain('data-privacy-deliver="r1" data-response="x1" data-org="org"');
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);

    const page = renderToStaticMarkup(
      createElement(SheetPrivacy, {
        data: {
          rows: [],
          selected: null,
          limits: { icon: "clock", title: "Legal time limits", label: "Legal time limits", columns: ["Provision"], rows: [], empty: "None entered." },
        },
      }),
    );
    expect(page).toContain('<section class="panel"><h2>');
    expect(page).toContain("None entered.");
  });

  it("words database refusals plainly", () => {
    expect(privacyResponseError("that is later than the official extension allows")).toBe("That’s later than the official extension allows.");
    expect(privacyResponseError("step-up is required")).toBe("Confirm with your authenticator, passkey, or a recovery code, then try again.");
    expect(privacyResponseError("some internal detail")).toBe("That action could not be completed.");
  });
});
