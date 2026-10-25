// SRC-05 and SRC-12 presentation: the pinned rule pack panel and Review upgrade dialog, the support
// catalogue (staff and public), the New matter dialog's program choices, the export manifest's
// versions and the capture script's checks. Every value is a FICTIONAL fixture, not IRCC content.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatterRulePin } from "@/components/sheet/designer/matter-rule-pin";
import { SheetSupportCatalogue } from "@/components/sheet/designer/support-catalogue";
import { buildExportPackage, rulePinLine } from "@/modules/exports/package";
import { readZip } from "@/modules/exports/zip";
import { programChoices, readNewMatter } from "@/modules/sheet/new-matter";
import { impactSections, matterRulePin, pinForm, ruleUpgradeError, type MatterRuleState } from "@/modules/sheet/rule-pin-present";
import { supportCatalogue, SUPPORT_PUBLIC_HREF } from "@/modules/sheet/support-catalogue-present";
import { captureRequest, isDeepOfficialUrl, parseArgs, parseDateModified, parseHeading } from "../scripts/ops/support-catalogue.mjs";

const ZONE = "America/Toronto";
const ORG = "00000000-0000-4000-8000-000000000001";
const MATTER = "00000000-0000-4000-8000-000000000002";
const PACK = "00000000-0000-4000-8000-000000000003";
const URL_A = "https://www.canada.ca/en/fictional-form-page.html";

const pinned: MatterRuleState = {
  matter_version: 7,
  scope: { program_key: "fictional_program", supported: true },
  binding: {
    pinned_at: "2026-10-22T14:00:00Z",
    recheck_required: false,
    program_key: "fictional_program",
    jurisdiction: "CA",
    pack_version: 1,
    pack_status: "published",
    platform: false,
    forms: [
      { form_number: "IMM 9001", date_modified: "2025-01-15", source_url: URL_A, retrieved_at: "2026-10-20T12:00:00Z", content_hash: "a".repeat(64) },
      { form_number: "IMM 9002", date_modified: null, source_url: null, retrieved_at: null, content_hash: null },
    ],
  },
  newer: null,
};

describe("SRC-05: the pinned rule pack on the matter overview", () => {
  it("shows the pack and each form's date modified as the page states it, or Unknown", () => {
    const data = matterRulePin(pinned, { organizationId: ORG, matterId: MATTER, timeZone: ZONE, canDecide: true });
    expect(data?.title).toBe("Rule pack v1");
    expect(data?.badge).toEqual({ tone: "ok", label: "Pinned" });
    expect(data?.parts).toEqual(["Fictional program", "CA", "Firm pack", "pinned 22 Oct 2026"]);
    expect(data?.forms.map((form) => [form.number, form.modified, form.href])).toEqual([
      ["IMM 9001", "date modified 2025-01-15", URL_A],
      ["IMM 9002", "date modified Unknown", null],
    ]);
    expect(data?.forms[1].facts).toEqual(["no approved evidence for this form’s page"]);
    expect(data?.upgrade).toBeNull();
    const html = renderToStaticMarkup(createElement(MatterRulePin, { data: data! }));
    expect(html).toContain("Form IMM 9001 (date modified 2025-01-15)");
    expect(html).toContain("Form IMM 9002 (date modified Unknown)");
    expect(html).not.toContain("Review upgrade");
    expect(pinForm({ form_number: "IMM 9003", date_modified: "15 January 2025" }, ZONE)?.modified).toBe("date modified Unknown");
  });

  it("is honest when there is no approved rule pack, and when a program is not supported", () => {
    const none = matterRulePin({ matter_version: 1, binding: null, scope: null }, { organizationId: ORG, matterId: MATTER, timeZone: ZONE, canDecide: true });
    expect(none?.title).toBe("No approved rule pack");
    expect(none?.note).toMatch(/applies no checklist, rules or form versions/);
    const unsupported = matterRulePin(
      { matter_version: 1, binding: null, scope: { program_key: "fictional_other", supported: false } },
      { organizationId: ORG, matterId: MATTER, timeZone: ZONE, canDecide: true },
    );
    expect(unsupported?.badge).toEqual({ tone: "chg", label: "Not supported" });
    expect(unsupported?.note).toMatch(/Fictional other is not supported yet.*none are taken from another program/);
  });

  it("offers Review upgrade with an impact preview to a licensed consultant or owner only", () => {
    const state: MatterRuleState = {
      ...pinned,
      binding: { ...pinned.binding, recheck_required: true },
      newer: {
        pack_id: PACK,
        pack_version: 2,
        release_notes: "Fictional release notes",
        impact: {
          rules: [
            { stable_key: "CA.FICTIONAL.CHECK", kind: "checklist_item", change: "changed", from_version: 1, to_version: 2, claim: "FICTIONAL claim" },
            { stable_key: "CA.FICTIONAL.FIELD", kind: "field", change: "added", from_version: null, to_version: 1, claim: null },
            { stable_key: "CA.FICTIONAL.DEAD", kind: "deadline", change: "removed", from_version: 1, to_version: null, claim: null },
          ],
          matter_checklist: [{ label: "Fictional checklist item" }],
          matter_deadlines: [{ label: "Fictional deadline", due_on: "2027-01-05" }],
          forms: [{ form_number: "IMM 9001", change: "changed", from_modified: "2025-01-15", to_modified: "2025-06-01" }],
        },
        decision: { decision: "declined", reason: "Client already filed", decided_at: "2026-10-24T15:00:00Z" },
      },
    };
    const data = matterRulePin(state, { organizationId: ORG, matterId: MATTER, timeZone: ZONE, canDecide: true });
    expect(data?.badge).toEqual({ tone: "chg", label: "Source changed: recheck" });
    expect(data?.upgrade?.title).toBe("Version 2 is approved");
    expect(data?.upgrade?.decision).toBe("Declined 24 Oct 2026: Client already filed");
    expect(data?.upgrade?.open).toEqual({ "data-open": "dPinUp" });
    expect(data?.upgrade?.dialog?.accept).toEqual({ "data-pin": "accept", "data-org": ORG, "data-matter": MATTER, "data-pack": PACK, "data-version": "7" });
    const sections = Object.fromEntries((data?.upgrade?.dialog?.sections ?? []).map((section) => [section.title, section.items]));
    expect(sections["Checklist items"]).toEqual(["Changed: CA.FICTIONAL.CHECK (v1 to v2). FICTIONAL claim"]);
    expect(sections.Fields).toEqual(["Added: CA.FICTIONAL.FIELD (v1)"]);
    expect(sections.Deadlines).toEqual(["Removed: CA.FICTIONAL.DEAD (v1)"]);
    expect(sections.Forms).toEqual(["Changed: IMM 9001, date modified 2025-01-15 to 2025-06-01"]);
    expect(sections["Other rules"]).toEqual([]);
    expect(sections["This matter’s checklist items from a changed rule"]).toEqual(["Fictional checklist item"]);
    expect(sections["This matter’s deadlines from a changed rule"]).toEqual(["Fictional deadline, due 5 Jan 2027"]);
    const html = renderToStaticMarkup(createElement(MatterRulePin, { data: data! }));
    expect(html).toContain('id="dPinUp"');
    expect(html).toContain('data-pin="decline"');
    expect(html).toContain("Accept upgrade");

    const viewer = matterRulePin(state, { organizationId: ORG, matterId: MATTER, timeZone: ZONE, canDecide: false });
    expect(viewer?.upgrade?.open).toBeNull();
    expect(viewer?.upgrade?.dialog).toBeNull();
    expect(impactSections({}).every((section) => section.items.length === 0)).toBe(true);
  });

  it("says refusals in plain words", () => {
    expect(ruleUpgradeError("matter version conflict")).toMatch(/Reload/);
    expect(ruleUpgradeError("staff access denied")).toBe("Only a licensed consultant or the firm owner can decide an upgrade.");
    expect(ruleUpgradeError("step-up is required")).toMatch(/authenticator/);
    expect(ruleUpgradeError("that is not a newer version of this matter's rule pack")).toMatch(/isn’t a newer version/);
  });

  it("records the versions in an export's manifest, and leaves them out of a privacy response", async () => {
    const meta = { exportId: "e1", firm: "Fictional Firm", matterReference: "CA-2026-0001", matterTitle: "Fictional", generatedAt: "2026-10-25T12:00:00.000Z", generatedBy: "Dana Lee", timezone: ZONE };
    const pin = { rulePackVersionId: PACK, programKey: "fictional_program", packVersion: 1, forms: [{ form_number: "IMM 9001", date_modified: "2025-01-15", source_url: URL_A, content_hash: "a".repeat(64) }] };
    const withPin = await buildExportPackage({ ...meta, rulePin: pin }, [], [], []);
    const manifest = JSON.parse(new TextDecoder().decode(readZip(withPin.zip).find((entry) => entry.path === "manifest.json")!.bytes));
    expect(manifest.rule_pack).toEqual({ rule_pack_version_id: PACK, program_key: "fictional_program", pack_version: 1, forms: pin.forms });
    const none = await buildExportPackage({ ...meta, rulePin: null }, [], [], []);
    expect(JSON.parse(new TextDecoder().decode(readZip(none.zip).find((entry) => entry.path === "manifest.json")!.bytes)).rule_pack).toBeNull();
    const privacy = await buildExportPackage(meta, [], [], []);
    expect("rule_pack" in JSON.parse(new TextDecoder().decode(readZip(privacy.zip).find((entry) => entry.path === "manifest.json")!.bytes))).toBe(false);
    expect(rulePinLine(pin)).toBe("v1 (fictional_program); forms IMM 9001 (date modified 2025-01-15)");
    expect(rulePinLine(null)).toBe("None pinned");
  });
});

describe("SRC-12: What Casevoya supports", () => {
  const json = {
    programs: [
      {
        key: "fictional_reviewed",
        label: "Working label",
        jurisdiction: "CA",
        case_type: "ircc_application",
        supported: true,
        pack_version: 3,
        pack_scope: "platform",
        official: { name: "Fictional Official Name", url: URL_A, section: "eligibility", retrieved_at: "2026-10-25T12:00:00Z", modified_on: "2026-01-02", content_hash: "b".repeat(64), reviewed: true },
      },
      { key: "fictional_draft", label: "Draft label", jurisdiction: "CA", supported: false, official: { name: "Not yet shown", url: URL_A, reviewed: false } },
      { key: "fictional_uncaptured", label: null, jurisdiction: "CA-ON", supported: false, official: null },
    ],
    jurisdictions: [
      { key: "CA", label: "Canada (federal immigration)", note: "Federal.", supported: true, firm_practises: true },
      { key: "CA-QC", label: "Quebec", note: "Provincial programs.", supported: false, firm_practises: false },
    ],
    case_types: [{ key: "irb_proceeding", label: "Immigration and Refugee Board proceedings", note: null, supported: false }],
    firm_jurisdictions: ["CA"],
  };

  it("names a program officially only from its reviewed page, and says when the source isn't captured", () => {
    const data = supportCatalogue(json, { timeZone: ZONE, staff: true });
    expect(data.programs.map((row) => [row.name, row.href, row.badge.label])).toEqual([
      ["Fictional Official Name", `${URL_A}#eligibility`, "Supported"],
      ["Draft label", null, "Not supported"],
      ["Fictional uncaptured", null, "Not supported"],
    ]);
    expect(data.programs[0].facts).toEqual(["CA", "retrieved 25 Oct 2026", "date modified 2026-01-02", `sha256 ${"b".repeat(10)}…`]);
    expect(data.programs[0].detail).toMatch(/^Approved, sourced rule pack v3 \(Casevoya pack\)/);
    expect(data.programs[1].detail).toMatch(/captured; its name and link show once the capture is reviewed/);
    expect(data.programs[2].detail).toMatch(/nothing is taken from another program.*Source not captured/);
    expect(data.jurisdictions[0].facts).toEqual(["CA", "your firm practises here"]);
    expect(data.firm).toBe("CA");
    expect(data.notes.join(" ")).toMatch(/doesn’t submit to IRCC/);
    expect(supportCatalogue(json, { timeZone: ZONE, staff: false }).firm).toBeNull();

    const html = renderToStaticMarkup(createElement(SheetSupportCatalogue, { data }));
    expect(html).toContain("What Casevoya supports");
    expect(html).toContain(`href="${URL_A}#eligibility"`);
    expect(html).toContain(`href="${SUPPORT_PUBLIC_HREF}"`);
    expect(html).toContain("Not supported");
    const empty = renderToStaticMarkup(createElement(SheetSupportCatalogue, { data: { ...supportCatalogue(null, { timeZone: ZONE, staff: true }), unavailable: true } }));
    expect(empty).toContain("couldn’t be read just now");
  });

  it("offers catalogue programs in New matter: supported first, unsupported marked, default only a supported one", () => {
    const choices = programChoices(json.programs);
    expect(choices.options).toEqual([
      { value: "fictional_reviewed", label: "Fictional Official Name · v3" },
      { value: "fictional_draft", label: "Draft label (not supported: no approved rule pack)" },
      { value: "fictional_uncaptured", label: "Fictional uncaptured (not supported: no approved rule pack)" },
    ]);
    expect(choices.defaultValue).toBe("fictional_reviewed");
    expect(programChoices([{ key: "fictional_x", supported: false }]).defaultValue).toBe("");
    const read = readNewMatter({ applicantName: "Ana", consultant: "c", program: "fictional_draft" });
    expect(read).toMatchObject({ input: { programKey: "fictional_draft", rulePackVersionId: null } });
    const byPack = readNewMatter({ applicantName: "Ana", consultant: "c", program: PACK });
    expect(byPack).toMatchObject({ input: { rulePackVersionId: PACK } });
    expect("programKey" in (byPack as { input: object }).input).toBe(false);
  });

  it("checks the capture script's input: deep official pages only, dates and names as the page shows them", () => {
    expect(isDeepOfficialUrl("https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit.html")).toBe(true);
    expect(isDeepOfficialUrl("https://www.canada.ca/")).toBe(false);
    expect(isDeepOfficialUrl("https://www.canada.ca/en/immigration-refugees-citizenship.html")).toBe(false);
    expect(isDeepOfficialUrl("https://www.canada.ca/en.html")).toBe(false);
    expect(isDeepOfficialUrl("http://www.canada.ca/en/x/y.html")).toBe(false);
    expect(isDeepOfficialUrl("https://canada.ca.example.com/en/x.html")).toBe(false);
    expect(parseDateModified('<dl><dt>Date modified:</dt><dd><time property="dateModified">2026-03-04</time></dd></dl>')).toBe("2026-03-04");
    expect(parseDateModified("<p>No date here</p>")).toBeNull();
    expect(parseHeading('<h1 property="name" id="wb-cont">Fictional &amp; program</h1>')).toBe("Fictional & program");
    const { options } = parseArgs(["capture", "--key", "fictional_x", "--label", "X", "--jurisdiction", "CA", "--url", "https://www.canada.ca/", "--dry-run"]);
    expect(() => captureRequest(options)).toThrow(/not a homepage/);
    expect(() => parseArgs(["nope"])).toThrow(/Usage/);
  });
});
