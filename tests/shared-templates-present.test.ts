import { describe, expect, it } from "vitest";
import { assembleSharedTemplates, isFirstVersion, templateChanges } from "@/modules/sheet/shared-template-present";

const body = (title: string, items: string[]) => ({ title, summary: "Synthetic summary", items });

describe("ADM-03 shared template diff", () => {
  it("lists every field of a first version and only the fields that changed after that", () => {
    const first = templateChanges(null, body("Checklist", ["One"]));
    expect(isFirstVersion(first)).toBe(true);
    expect(first.map((change) => change.field)).toEqual(["title", "summary", "items"]);
    expect(first[0]).toMatchObject({ before: "", after: "Checklist" });
    const next = templateChanges(body("Checklist", ["One"]), body("Checklist", ["One", "Two"]));
    expect(next).toEqual([{ field: "items", before: "One", after: "One\nTwo" }]);
    expect(templateChanges(body("Checklist", ["One"]), body("Checklist", ["One"]))).toEqual([]);
  });

  it("keeps a firm override apart from the reviewed version and shows a notice", () => {
    const view = assembleSharedTemplates({
      can_adopt: true,
      can_override: true,
      can_pin: false,
      notices: [{ id: "n1", kind: "published", version_id: "v2", version_number: 2, title: "Synthetic template", stable_key: "synthetic_template", changelog: "Added an item" }],
      versions: [
        {
          id: "v1",
          template_id: "t1",
          stable_key: "synthetic_template",
          template_title: "Synthetic template",
          version_number: 1,
          status: "superseded",
          body: body("Synthetic template", ["One"]),
          author_name: "Synthetic Author",
          reviewer_label: "RCIC R123",
          effective_on: "2026-10-01",
          changelog: "First",
          test_evidence: "Synthetic tests passed",
          reviewed_at: "2026-10-01",
          published_at: "2026-10-01",
          supersedes_version_id: null,
        },
        {
          id: "v2",
          template_id: "t1",
          stable_key: "synthetic_template",
          template_title: "Synthetic template",
          version_number: 2,
          status: "published",
          body: body("Synthetic template", ["One", "Two"]),
          author_name: "Synthetic Author",
          reviewer_label: "RCIC R123",
          effective_on: "2026-11-01",
          changelog: "Added an item",
          test_evidence: "Synthetic tests passed",
          reviewed_at: "2026-11-01",
          published_at: "2026-11-01",
          supersedes_version_id: "v1",
        },
      ],
      adoptions: [{ template_id: "t1", version_id: "v1" }],
      overrides: [{ template_id: "t1", kind: "edit", body: body("Firm title", ["Firm item"]), reason: "Firm wording", based_on_version_id: "v2" }],
      pins: [{ template_id: "t1", count: 1 }],
      matters: [],
    });
    expect(view.notices[0].kind).toBe("published");
    expect(view.templates[0].adoption).toEqual({ versionId: "v1", versionNumber: 1 });
    expect(view.templates[0].published?.versionNumber).toBe(2);
    expect(view.templates[0].diff).toEqual([{ field: "items", before: "One", after: "One\nTwo" }]);
    expect(view.templates[0].override?.body.title).toBe("Firm title");
    expect(view.templates[0].override?.basedOnVersionNumber).toBe(2);
    expect(view.templates[0].pins).toBe(1);
    expect(view.templates[0].history.map((version) => version.status)).toEqual(["superseded", "published"]);
  });
});
