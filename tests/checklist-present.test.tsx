import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApplyChecklist } from "@/components/sheet/designer/apply-checklist";
import { ChecklistsLive } from "@/components/sheet/designer/checklists-live";
import { formatsText } from "@/components/portal/documents-live";
import { checklistCard, checklistError, fromChecklist, itemKey, keyFromTitle, readProposals, type ChecklistTemplateView } from "@/modules/sheet/checklist-present";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, replace: () => undefined }) }));

// DOC-01 (#178): firm checklist templates and Apply checklist. Synthetic records only.

const template = (status: ChecklistTemplateView["status"]): ChecklistTemplateView => ({
  id: `t-${status}`,
  stableKey: "spousal",
  title: "Spousal sponsorship",
  versionNumber: 2,
  status,
  rowVersion: 3,
  approvedBy: status === "approved" ? "Amara Osei" : null,
  items: [
    { item_key: "passport", purpose: "Passport", explanation: "The bio page.", owner: "client", due_offset_days: 14, acceptable_formats: ["pdf"], review_criteria: "", records_expiry: true, party_role: "applicant", condition_field: "", condition_equals: "" },
    { item_key: "marriage", purpose: "Marriage certificate", explanation: "From the registry.", owner: "client", due_offset_days: null, acceptable_formats: ["pdf"], review_criteria: "", records_expiry: false, party_role: "applicant", condition_field: "marital_status", condition_equals: "married" },
  ],
});

describe("checklist words", () => {
  it("makes stable keys from titles and unique item keys", () => {
    expect(keyFromTitle("Spousal sponsorship (inland)")).toBe("spousal_sponsorship_inland");
    expect(keyFromTitle("2026 study permit")).toBe("checklist_2026_study_permit");
    expect(itemKey("Passport bio page", new Set(["passport_bio_page"]))).toBe("passport_bio_page_2");
  });

  it("describes a template version on its card", () => {
    expect(checklistCard(template("approved"))).toEqual({
      title: { left: "Spousal sponsorship", right: "v2" },
      note: { left: "2 items, 1 on an intake answer", right: "1 kinds of people" },
      tag: "Approved by Amara Osei",
    });
    expect(checklistCard(template("draft")).tag).toBe("Draft");
    expect(fromChecklist("Spousal sponsorship", 2)).toBe("From Spousal sponsorship v2");
  });

  it("reads the preview and words the refusals", () => {
    expect(readProposals({ add: [{ item_id: "i1", purpose: "Passport", person_id: "p1", person: "Francis" }], remove: [], waiting: [{ purpose: "Marriage certificate", person: "Francis", field: "marital_status" }], template: { title: "Spousal", version_number: 2 } })).toEqual({
      add: [{ itemId: "i1", purpose: "Passport", personId: "p1", person: "Francis" }],
      remove: [],
      waiting: [{ purpose: "Marriage certificate", person: "Francis", field: "marital_status" }],
      template: { title: "Spousal", versionNumber: 2 },
    });
    expect(readProposals(null)).toEqual({ add: [], remove: [], waiting: [], template: null });
    expect(checklistError("an approved checklist doesn''t change; save a new version")).toBe("An approved checklist doesn’t change; save a new version.");
    expect(checklistError("the checklist changed; look at the proposals again")).toBe("The checklist or the answers changed. Preview it again.");
    expect(checklistError("checklist denied")).toBe("You can’t do that with this checklist.");
  });

  it("names the formats a request accepts in the portal", () => {
    expect(formatsText(["pdf", "jpeg"])).toBe("PDF or JPG");
    expect(formatsText(undefined)).toBe("PDF, JPG, PNG, HEIC or DOCX");
  });
});

describe("checklist screens", () => {
  it("shows Edit and Approve on a draft, New version on an approved one, and nothing on a retired one", () => {
    const html = renderToStaticMarkup(createElement(ChecklistsLive, { data: { organizationId: "o1", edit: true, approve: true, conditions: [], templates: [template("draft"), template("approved"), template("retired")] } }));
    expect(html).toContain("New checklist");
    expect(html.match(/>Edit</g)).toHaveLength(1);
    expect(html.match(/>Approve</g)?.length).toBe(2); // the button, and the dialog's button
    expect(html.match(/>New version</g)).toHaveLength(1);
    const viewer = renderToStaticMarkup(createElement(ChecklistsLive, { data: { organizationId: "o1", edit: false, approve: false, conditions: [], templates: [template("draft")] } }));
    expect(viewer).not.toContain("New checklist");
    expect(viewer).not.toContain(">Edit<");
  });

  it("offers Apply checklist with the approved checklists", () => {
    const html = renderToStaticMarkup(createElement(ApplyChecklist, { data: { organizationId: "o1", matterId: "m1", templates: [{ id: "t1", label: "Spousal sponsorship v2" }] } }));
    expect(html).toContain("Apply checklist");
    expect(html).toMatch(/<option value="t1"( selected="")?>Spousal sponsorship v2<\/option>/);
    expect(html).toContain("Each request shows the checklist and version it came from.");
  });
});
