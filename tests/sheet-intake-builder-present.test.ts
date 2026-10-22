import { describe, expect, it } from "vitest";
import { builderPage, fieldRow, fieldToggles, newField, nextKey, relabel, toggleField, type IntakeField, type TemplateRow } from "@/modules/sheet/intake-builder-present";

const NOW = new Date("2026-10-18T15:00:00Z");

const NAME: IntakeField = { key: "full_name", type: "text", ui: "short", labels: { "en-CA": "Full legal name" }, required: true, allow_unknown: false, allow_not_applicable: false };
const DOB: IntakeField = { key: "dob", type: "date", labels: { "en-CA": "Date of birth" }, required: true, allow_unknown: true };
const PRIOR: IntakeField = { key: "prior", type: "repeatable", labels: { "en-CA": "Previous marriage details" }, show_when: { field: "married", equals: "yes" } };

function row(overrides: Partial<TemplateRow>): TemplateRow {
  return { id: "t1", stableKey: "about_you", versionNumber: 1, status: "published", title: "About you", schema: { fields: [NAME, DOB] }, updatedAt: "2026-10-17T15:00:00Z", effectiveOn: "2026-10-17", version: 3, ...overrides };
}

describe("Intake form builder", () => {
  it("describes fields in the Designer's words", () => {
    expect(fieldRow(NAME)).toEqual({ key: "full_name", label: "Full legal name", typeLabel: "Short text", note: "Required", conditional: false, badge: null });
    expect(fieldRow(DOB).badge).toEqual({ tone: "gr", label: "Unknown allowed" });
    expect(fieldRow(PRIOR)).toMatchObject({ typeLabel: "Repeating rows", note: "Shows if “Yes” above", conditional: true, badge: { tone: "blue", label: "Conditional" } });
    expect(fieldToggles(NAME).map((toggle) => toggle.on)).toEqual([true, false, false, false]);
    // A field with no flags keeps the original rule: Unknown and Not applicable are accepted.
    expect(fieldToggles(PRIOR).map((toggle) => toggle.on)).toEqual([false, true, true, false]);
  });

  it("flips switches, relabels without changing the key, and adds fields with fresh stable keys", () => {
    expect(toggleField(NAME, 0).required).toBe(false);
    expect(toggleField(NAME, 1).allow_unknown).toBe(true);
    expect(toggleField(NAME, 3).section_key).toBe("shared_family_record");
    expect(toggleField(toggleField(NAME, 3), 3).section_key).toBeUndefined();
    expect(relabel(NAME, "Legal name").key).toBe("full_name");
    expect(nextKey([NAME, { ...DOB, key: "question_3" }])).toBe("question_4");
    expect(newField("Yes / No", [NAME])).toEqual({ key: "question_2", type: "choice", ui: "yes_no", options: ["yes", "no"], labels: { "en-CA": "New question" }, required: false, allow_unknown: false, allow_not_applicable: false });
    expect(newField("Section", [NAME])).toBeNull();
  });

  it("shows the draft when there is one, else the published version as the start of the next draft", () => {
    const published = builderPage([row({})], new Map([["about_you", 2]]), {}, NOW);
    expect(published).toMatchObject({
      title: "About you v1",
      pills: [{ left: "Published", right: "in effect from 17 Oct" }, "Used by 2 matters"],
      publishLabel: "Publish v2",
      live: { templateId: null, version: null, status: "published", stableKey: "about_you" },
    });
    expect(published.rows.map((item) => item.selected)).toEqual([true, false]);
    const draft = builderPage([row({}), row({ id: "t2", versionNumber: 2, status: "draft", updatedAt: "2026-10-18T14:58:00Z", version: 5 })], new Map(), { field: "dob" }, NOW);
    expect(draft).toMatchObject({
      title: "About you v2",
      pills: [{ left: "Draft", right: "autosaved 2 min ago" }, "Used by 0 matters"],
      publishLabel: "Publish v2",
      // Keyed by the field so an autosave doesn't rebuild the label box mid-typing.
      settings: { key: "dob", label: "Date of birth" },
      live: { templateId: "t2", version: 5, status: "draft" },
    });
    const none = builderPage([], new Map(), {}, NOW);
    expect(none).toMatchObject({ title: "Intake form", rows: [], publishLabel: "Publish v1", live: { status: "new", stableKey: "intake_form" } });
  });
});
