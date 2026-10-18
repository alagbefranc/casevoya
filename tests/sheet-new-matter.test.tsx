import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MattersTopBar, NewMatterDialog } from "@/components/sheet/designer/matters";
import {
  consultantOptions,
  needsStepUp,
  newMatterError,
  newMatterStepUpLocation,
  programOptions,
  readNewMatter,
  withoutNew,
} from "@/modules/sheet/new-matter";

const AMARA = "6f0c1d1e-8a3f-4b55-9d61-3b1d2c4e5f60";
const GRACE = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("new matter options", () => {
  it("labels consultants by licence state, like the Designer's Convert dialog", () => {
    const options = consultantOptions(
      [
        { id: AMARA, name: "Amara Osei" },
        { id: GRACE, name: "Grace Lin" },
        { id: "x", name: "Sam Roe" },
      ],
      new Map([
        [AMARA, "verified"],
        [GRACE, "declared"],
        ["x", "suspended"],
      ]),
    );
    expect(options).toEqual([
      { value: AMARA, label: "Amara Osei" },
      { value: GRACE, label: "Grace Lin (licence check pending: can’t sign yet)" },
      { value: "x", label: "Sam Roe (licence blocks new matters)" },
    ]);
  });

  it("lists published packs by program, newest version first", () => {
    expect(
      programOptions([
        { id: "a", program_key: "work_permit", pack_version: 1, status: "published" },
        { id: "b", program_key: "visitor_record", pack_version: 3, status: "review_due" },
        { id: "c", program_key: "work_permit", pack_version: 2, status: "published" },
      ]),
    ).toEqual([
      { value: "b", label: "Visitor record · v3 review due" },
      { value: "c", label: "Work permit · v2" },
      { value: "a", label: "Work permit · v1" },
    ]);
  });
});

describe("readNewMatter", () => {
  const base = { applicantName: " Ana  Pereira ", applicantEmail: " Ana@Example.Test ", sponsorName: "", sponsorEmail: "", consultant: AMARA, program: "" };

  it("cleans what the dialog sends", () => {
    expect(readNewMatter(base)).toEqual({
      input: {
        applicantName: "Ana Pereira",
        applicantEmail: "ana@example.test",
        sponsorName: null,
        sponsorEmail: null,
        consultantMembershipId: AMARA,
        rulePackVersionId: null,
      },
    });
  });

  it("asks for what is missing before calling the database", () => {
    expect(readNewMatter({ ...base, applicantName: "  " })).toEqual({ error: "Add the applicant’s name." });
    expect(readNewMatter({ ...base, applicantEmail: "nope" })).toEqual({ error: "Enter a valid email address." });
    expect(readNewMatter({ ...base, sponsorEmail: "s@example.test" })).toEqual({ error: "Add the sponsor’s name, or leave the sponsor out." });
    expect(readNewMatter({ ...base, consultant: "" })).toEqual({ error: "Choose a responsible consultant." });
    expect(readNewMatter({ ...base, applicantName: "x".repeat(201) })).toEqual({ error: "Names can be up to 200 characters." });
  });
});

describe("newMatterError", () => {
  it("says honestly why the firm refused, without passing the database message through", () => {
    expect(newMatterError("this firm is in sample mode; new people and matters must be flagged as sample")).toMatch(/still in sample mode/);
    expect(newMatterError("licence blocks")).toMatch(/licence blocks this new matter/);
    expect(newMatterError("the responsible consultant must be an active licensed consultant")).toMatch(/active licensed consultant/);
    expect(newMatterError("program selection must be a published pack for a jurisdiction this firm practises")).toMatch(/published program template/);
    expect(newMatterError("matter create denied")).toMatch(/role can’t open matters/);
    expect(newMatterError("relation secret_table does not exist")).toBe("That action could not be completed.");
  });

  it("treats an aal2 refusal as a step-up", () => {
    expect(needsStepUp(newMatterError("aal2 is required to open a matter"))).toBe(true);
    expect(needsStepUp(newMatterError("matter create denied"))).toBe(false);
  });
});

describe("step-up round trip", () => {
  it("comes back to the same page with the dialog open, and closing drops the flag", () => {
    const location = newMatterStepUpLocation("/sheet/matters", "?view=due");
    expect(location).toBe(`/mfa?step=6&next=${encodeURIComponent("/sheet/matters?view=due&new=1")}`);
    expect(withoutNew("/sheet/matters", "?view=due&new=1")).toBe("/sheet/matters?view=due");
    expect(withoutNew("/sheet/matters", "?new=1")).toBe("/sheet/matters");
  });
});

describe("New matter dialog markup", () => {
  it("uses the Designer's dialog structure and wires the top bar button only on request", () => {
    const html = renderToStaticMarkup(
      createElement(NewMatterDialog, {
        data: { organizationId: "org", consultants: [{ value: AMARA, label: "Amara Osei" }], programs: [], sampleMode: true },
      }),
    );
    expect(html).toContain('<dialog class="dlg" id="dlgNew" aria-labelledby="dlgNewH"><div class="dh"><h2 id="dlgNewH">New matter</h2>');
    expect(html).toContain('<div class="db">');
    expect(html).toContain('<div class="df"><button class="btn" data-close="dlgNew">Cancel</button><button class="btn p" data-new-matter="1" data-org="org">Create matter</button></div>');
    expect(html).toContain('<select class="sel" id="nmC">');
    expect(html).toContain("This firm is in sample mode");
    expect(html).toContain("Needs a signed service agreement");

    const counts = { active: 0, blocked: 0, mine: 0, everyone: 0 };
    expect(renderToStaticMarkup(createElement(MattersTopBar, { counts }))).not.toContain("data-open");
    expect(renderToStaticMarkup(createElement(MattersTopBar, { counts, newMatter: true }))).toContain('data-open="dlgNew"');
  });
});
