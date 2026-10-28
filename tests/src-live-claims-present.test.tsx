import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LiveOfficialClaims, OfficialClaimDetail, OfficialClaimDialogs } from "@/components/sheet/designer/official-claims";
import { SheetTemplates } from "@/components/sheet/designer/templates";
import { claimStamp, liveClaimsData, officialClaimError, officialClaimView, type OfficialClaimJson } from "@/modules/sheet/official-claims-present";
import { programRow } from "@/modules/sheet/support-catalogue-present";
import { templatesData } from "@/modules/sheet/templates-present";
import { sourceItems } from "@/modules/sheet/vo-present";
import { sourceRows } from "@/modules/sheet/letters-present";
import { citationsFor, editStampLine, withStoredAttestation } from "@/modules/vo/grounding";

/**
 * Live official claims on screen (#188, decisions 2026-10-25): a captured official claim is live
 * with no label; a firm edit shows only "Edited by <name>, licence <number>, <date>" in Source
 * review, History, the support catalogue and Vo citations; "Source changed since your edit" shows
 * the new official text; an overdue source says so. Synthetic values only.
 */

const TZ = "America/Toronto";
const EDIT = { id: "e1", claim: "Synthetic: the firm wording.", value: null, reason: "Synthetic reason", editor: "Synthetic Consultant", licence_number: "R000001", edited_on: "2026-10-25", base_version_id: "v1", base_version_number: 1 };

function claim(overrides: Partial<OfficialClaimJson> = {}): OfficialClaimJson {
  return {
    definition_id: "11111111-1111-4111-8111-111111111111",
    stable_key: "CA.SYNTH.CLAIM",
    program_key: "study_permit",
    jurisdiction: "CA",
    category: "checklist",
    version_id: "22222222-2222-4222-8222-222222222222",
    version_number: 1,
    official_claim: "Synthetic: the official wording.",
    official_value: null,
    claim: "Synthetic: the official wording.",
    value: null,
    source_url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/synthetic/page.html#s1",
    section: "Synthetic section",
    excerpt: "Synthetic excerpt.",
    form_number: null,
    modified_on: "2026-09-01",
    last_amended_on: null,
    current_to: null,
    checked_on: "2026-10-25",
    publisher: "Immigration, Refugees and Citizenship Canada",
    sha256: "a".repeat(64),
    retrieved_at: "2026-10-25T15:00:00Z",
    last_checked_at: "2026-10-25T15:00:00Z",
    recheck_days: 7,
    stale: false,
    edit: null,
    source_changed: false,
    ...overrides,
  };
}

const viewer = (role = "licensed_consultant") => ({ organizationId: "o", role, timeZone: TZ });

describe("the stamp", () => {
  it("reads Edited by, licence and date, and nothing without all three", () => {
    expect(claimStamp(EDIT)).toBe("Edited by Synthetic Consultant, licence R000001, 25 Oct 2026");
    expect(claimStamp({ ...EDIT, licence_number: null })).toBeNull();
    expect(editStampLine("Synthetic Consultant", "R000001", "2026-10-25")).toBe(claimStamp(EDIT));
  });
});

describe("Source review", () => {
  it("lists a captured official claim as Live with no draft or review label, and an edited one with only its stamp", () => {
    const data = liveClaimsData({ total: 2, rows: [claim(), claim({ definition_id: "33333333-3333-4333-8333-333333333333", stable_key: "CA.SYNTH.EDITED", claim: EDIT.claim, edit: EDIT })] }, { query: "", offset: 0, timeZone: TZ });
    const html = renderToStaticMarkup(createElement(LiveOfficialClaims, { data }));
    expect(html).toContain("Live official claims (2)");
    expect(html).toContain(">Live<");
    expect(html).toContain("Edited by Synthetic Consultant, licence R000001, 25 Oct 2026");
    for (const label of ["Draft", "A draft until a licensed reviewer approves it", "Not reviewed", "Approve and publish"]) expect(html).not.toContain(label);
    expect(html).toContain("?tab=rule&amp;claim=11111111-1111-4111-8111-111111111111&amp;dlg=dlgClaimEdit");
    // The list shows on Source review, after the firm's register.
    const page = templatesData({ tab: "sources", program: [], messages: [], rules: [], packs: 0, selected: null, today: "2026-10-25" });
    page.sources.live = data;
    expect(renderToStaticMarkup(createElement(SheetTemplates, { data: page }))).toContain('id="live-claims"');
  });

  it("flags an overdue source and a source change, and pages through a search", () => {
    const stale = liveClaimsData({ total: 120, rows: [claim({ stale: true, last_checked_at: "2026-10-01T15:00:00Z", source_changed: true, edit: EDIT })] }, { query: "study", offset: 50, timeZone: TZ });
    const html = renderToStaticMarkup(createElement(LiveOfficialClaims, { data: stale }));
    expect(html).toContain("Overdue for a re-check");
    expect(html).toContain("last checked 1 Oct 2026");
    expect(html).toContain("Source changed since your edit");
    expect(stale.previous).toBe("?tab=sources&cq=study#live-claims");
    expect(stale.next).toBe("?tab=sources&cq=study&offset=51#live-claims");
  });
});

describe("Rule detail for a live official claim", () => {
  it("shows the firm's wording with its stamp, the new official text when the source changed, the evidence and the history", () => {
    const history = [
      { kind: "capture", at: "2026-10-25T15:00:00Z", version_number: 1, claim: "Synthetic: first wording.", sha256: "a".repeat(64), retrieved_at: "2026-10-25T15:00:00Z", section: "Synthetic section" },
      { kind: "edit", at: "2026-10-25T16:00:00Z", version_number: 1, claim: EDIT.claim, editor: EDIT.editor, licence_number: EDIT.licence_number, edited_on: "2026-10-25", reason: "Synthetic reason" },
      { kind: "recapture", at: "2026-10-26T15:00:00Z", version_number: 2, claim: "Synthetic: second wording.", sha256: "b".repeat(64), retrieved_at: "2026-10-26T15:00:00Z" },
    ];
    const view = officialClaimView(claim({ claim: EDIT.claim, edit: EDIT, source_changed: true, official_claim: "Synthetic: second wording.", version_number: 2 }), history, viewer())!;
    const html = renderToStaticMarkup(createElement(OfficialClaimDetail, { view }));
    expect(html).toContain(EDIT.claim);
    expect(html).toContain("Edited by Synthetic Consultant, licence R000001, 25 Oct 2026");
    expect(html).toContain("Source changed since your edit");
    expect(html).toContain("Synthetic: second wording.");
    expect(html).toContain("SHA-256 " + "a".repeat(64));
    expect(html).toContain("Captured, version 1");
    expect(html).toContain("Firm edit on version 1");
    expect(html).toContain("Re-captured, version 2");
    expect(html).toContain("Reason: Synthetic reason");
    const dialogs = renderToStaticMarkup(createElement(OfficialClaimDialogs, { view }));
    expect(dialogs).toContain('data-claim-act="edit"');
    expect(dialogs).toContain('data-claim-act="keep"');
    expect(dialogs).toContain('data-claim-act="revert"');
    expect(dialogs).toContain("Saving needs a fresh step-up, every time.");
    // A case manager sees the claim and its history, but no edit dialogs.
    const manager = officialClaimView(claim(), [], viewer("case_manager"))!;
    expect(renderToStaticMarkup(createElement(OfficialClaimDialogs, { view: manager }))).toBe("");
    expect(renderToStaticMarkup(createElement(OfficialClaimDetail, { view: manager }))).toContain("disabled");
  });

  it("explains refusals plainly", () => {
    expect(officialClaimError("rule version conflict")).toMatch(/changed since you opened it/);
    expect(officialClaimError("your licence isn't recorded: add it in Settings before editing a claim")).toMatch(/Licence/);
    expect(officialClaimError("a newer version of this claim is live")).toMatch(/stays suspended/);
  });
});

describe("the support catalogue", () => {
  it("counts live official claims as support, flags an overdue page and shows the firm's stamps", () => {
    const row = programRow(
      {
        key: "study_permit",
        supported: true,
        official_claims: 3,
        stale: true,
        last_checked_at: "2026-10-01T15:00:00Z",
        firm_edits: [{ key: "CA.SYNTH.CLAIM", edited_by: "Synthetic Consultant", edited_licence: "R000001", edited_on: "2026-10-25" }],
      },
      TZ,
    )!;
    expect(row.badge.label).toBe("Supported");
    expect(row.detail).toMatch(/^3 live official claims for its forms and checklists/);
    expect(row.flags).toEqual([
      "May be out of date: an official page behind it is due for a re-check (oldest last check 1 Oct 2026).",
      "CA.SYNTH.CLAIM: Edited by Synthetic Consultant, licence R000001, 25 Oct 2026.",
    ]);
    expect(programRow({ key: "visitor_visa", supported: false, official_claims: 0 }, TZ)!.badge.label).toBe("Not supported");
  });
});

describe("Vo citations", () => {
  it("carry the stamp the database stored, in Ask Vo, the drafts' source list and letters", () => {
    const refs = withStoredAttestation(
      [{ kind: "official", id: "r1", label: "Program rule: CA.SYNTH.CLAIM", sourceKind: "rule_version", url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/synthetic/page.html#s1", edited: true, editedBy: "Forged", editedLicence: "X", editedOn: "2026-01-01" }],
      [{ kind: "official", id: "r1", source_kind: "rule_version", edited: true, edited_by: "Synthetic Consultant", edited_licence: "R000001", edited_on: "2026-10-25" }],
    );
    const [citation] = citationsFor(refs, { matterId: "m" });
    expect(citation.edit).toBe("Edited by Synthetic Consultant, licence R000001, 25 Oct 2026");
    const items = sourceItems([{ kind: "official", id: "r1", label: "Synthetic fee", sourceKind: "rule_version", url: refs[0].url, edited: true, editedBy: "Synthetic Consultant", editedLicence: "R000001", editedOn: "2026-10-25" }], { matterId: "m" });
    expect(items[0]).toMatchObject({ detail: "Edited by Synthetic Consultant, licence R000001, 25 Oct 2026" });
    const letter = sourceRows([{ ref: "S1", kind: "rule_version", content: "Synthetic fee", source_url: refs[0].url, snapshot_sha256: "a".repeat(64), edited: true, edited_by: "Synthetic Consultant", edited_licence: "R000001", edited_on: "2026-10-25" }], TZ);
    expect(letter[0].detail).toContain("Edited by Synthetic Consultant, licence R000001, 25 Oct 2026");
  });
});
