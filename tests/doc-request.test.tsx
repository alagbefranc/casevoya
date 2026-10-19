import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatterDialogs, MatterTopBar, type MatterDialogsData } from "@/components/sheet/designer/matter";
import { DocRequestDialog, type DocRequestDialogData } from "@/components/sheet/designer/doc-request";
import { documentError } from "@/modules/documents/errors";
import { safeAccessError } from "@/lib/auth/step-up";
import { dialogId, needsStepUp, stepUpLocation } from "@/modules/sheet/matter-wire";
import { docRequestPersonLabel, mayRequestDocuments, readDocRequest, type DocRequestFields } from "@/modules/sheet/doc-request";
import { firmDay } from "./helpers/firm-day";

const PERSON = "11111111-1111-4111-8111-111111111111";
const TODAY = firmDay();
const FIELDS: DocRequestFields = {
  personId: PERSON,
  purpose: "  Passport,   all pages ",
  explanation: "Every page, including blank ones.\nA clear photo is fine.",
  dueOn: firmDay(14),
  formats: ["pdf", "jpeg", "png", "pdf", "exe"],
  sensitivity: "ordinary",
  audience: "subject",
  criteria: "",
};

describe("Request a document: what the dialog sends", () => {
  it("turns the dialog's fields into createDocumentRequest's input", () => {
    expect(readDocRequest(FIELDS, TODAY)).toEqual({
      input: {
        personId: PERSON,
        purpose: "Passport, all pages",
        explanation: "Every page, including blank ones.\nA clear photo is fine.",
        dueOn: firmDay(14),
        acceptableFormats: ["pdf", "jpeg", "png"],
        sensitivity: "ordinary",
        audience: "subject",
        reviewCriteria: null,
      },
    });
    const optional = readDocRequest({ ...FIELDS, dueOn: "", criteria: " Readable, not expired ", sensitivity: "criminal", audience: "staff", formats: ["heic", "docx"] }, TODAY);
    expect(optional).toMatchObject({ input: { dueOn: null, reviewCriteria: "Readable, not expired", sensitivity: "criminal", audience: "staff", acceptableFormats: ["heic", "docx"] } });
  });

  it("checks the person, the document, the explanation, the date and the formats before anything is sent", () => {
    expect(readDocRequest({ ...FIELDS, personId: "" }, TODAY)).toEqual({ error: "Choose who the request is for." });
    expect(readDocRequest({ ...FIELDS, purpose: "   " }, TODAY)).toEqual({ error: "Say which document you need." });
    expect(readDocRequest({ ...FIELDS, purpose: "x".repeat(201) }, TODAY)).toEqual({ error: "Keep the document name under 200 characters." });
    expect(readDocRequest({ ...FIELDS, explanation: "ok" }, TODAY)).toEqual({ error: "Explain to the client what the file should show." });
    expect(readDocRequest({ ...FIELDS, explanation: "x".repeat(2001) }, TODAY)).toEqual({ error: "Keep the explanation under 2,000 characters." });
    expect(readDocRequest({ ...FIELDS, dueOn: "2026-02-30" }, TODAY)).toEqual({ error: "Pick a real due date, or leave it empty." });
    expect(readDocRequest({ ...FIELDS, dueOn: firmDay(-1) }, TODAY)).toEqual({ error: "The due date has passed. Pick a later one." });
    expect(readDocRequest({ ...FIELDS, dueOn: TODAY }, TODAY)).toMatchObject({ input: { dueOn: TODAY } });
    expect(readDocRequest({ ...FIELDS, formats: ["exe"] }, TODAY)).toEqual({ error: "Choose at least one accepted format." });
    expect(readDocRequest({ ...FIELDS, sensitivity: "identity" }, TODAY)).toEqual({ error: "Choose how sensitive the document is." });
    expect(readDocRequest({ ...FIELDS, audience: "everyone" }, TODAY)).toEqual({ error: "Choose who may see it." });
  });

  it("offers the dialog only to the roles public.create_document_request accepts", () => {
    expect(["firm_owner", "licensed_consultant", "case_manager"].every(mayRequestDocuments)).toBe(true);
    expect(["assistant", "finance", "client", ""].some(mayRequestDocuments)).toBe(false);
  });

  it("names each person with their role and whether they can see the portal", () => {
    expect(docRequestPersonLabel("Dana Lee", "Applicant", true)).toBe("Dana Lee · Applicant · Portal active");
    expect(docRequestPersonLabel("Sam Lee", "Sponsor", false)).toBe("Sam Lee · Sponsor · No portal access yet");
  });

  it("comes back to the dialog after a step-up, and reads the database's refusals in plain words", () => {
    expect(dialogId("request")).toBe("dReq");
    expect(stepUpLocation("/sheet/matters/m-1", "?tab=documents", "request")).toBe(`/mfa?step=6&next=${encodeURIComponent("/sheet/matters/m-1?tab=documents&dlg=request")}`);
    expect(needsStepUp(documentError("step-up is required"))).toBe(true);
    expect(documentError("step-up is required")).toBe(safeAccessError("step-up is required"));
    expect(documentError("this firm is in sample mode; only sample matters accept new work")).toBe("This firm is in sample mode. Only sample matters accept new work.");
    expect(documentError("the request needs a person on this matter")).toBe("Choose someone who is on this matter.");
    expect(documentError("document request denied")).toBe("That action could not be completed.");
  });
});

const DIALOG: DocRequestDialogData = {
  organizationId: "org-1",
  matterId: "m-1",
  people: [
    { id: PERSON, label: "Dana Lee · Applicant · Portal active" },
    { id: "22222222-2222-4222-8222-222222222222", label: "Sam Lee · Sponsor · No portal access yet" },
  ],
  today: "2026-10-19",
  sampleMode: false,
};

const DIALOGS: MatterDialogsData = {
  current: 2,
  target: 3,
  version: 7,
  evidence: [],
  reason: "",
  owners: [{ id: "mem-1", name: "Dana Lee" }],
  reviewOn: "2026-10-31",
  receivedOn: "2026-10-17",
};

describe("Request a document: the dialog on the matter page", () => {
  it("is built from the Designer's dialog parts, with the defaults the request asks for", () => {
    const html = renderToStaticMarkup(createElement(DocRequestDialog, { data: DIALOG }));
    expect(html).toContain('<dialog class="dlg wide" id="dReq" aria-labelledby="dReqT"><div class="dh"><h2 id="dReqT">Request a document</h2>');
    expect(html).toContain('<button class="x" aria-label="Close" data-close="dReq">');
    expect(html).toContain('<select class="sel" id="drqP">');
    expect(html).toContain(`<option value="${PERSON}" selected="">Dana Lee · Applicant · Portal active</option>`);
    expect(html).toContain('<input class="inp" id="drqD" type="date" min="2026-10-19"/>');
    expect(html).toContain('<textarea class="ta" id="drqE" maxLength="2000"');
    expect(html).toContain('<option value="ordinary" selected="">Ordinary</option>');
    expect(html).toContain('<option value="subject" selected="">Only the person asked</option>');
    expect(html).toContain('<fieldset class="fld"><legend>Accepted formats</legend>');
    for (const format of ["pdf", "jpeg", "png"]) expect(html).toContain(`<input type="checkbox" name="drqF" checked="" value="${format}"/>`);
    for (const format of ["heic", "docx"]) expect(html).toContain(`<input type="checkbox" name="drqF" value="${format}"/>`);
    expect(html).toContain('<button class="btn p" data-doc-request="1" data-org="org-1" data-matter="m-1">Send request</button>');
    expect(html).not.toContain("alert warn");
    expect(html).not.toMatch(/Northline|Amara|Priya|Kofi|NL-2026/);
  });

  it("says honestly when the firm will refuse it, and cannot send to no one", () => {
    expect(renderToStaticMarkup(createElement(DocRequestDialog, { data: { ...DIALOG, sampleMode: true } }))).toContain("The firm will refuse this one.");
    const empty = renderToStaticMarkup(createElement(DocRequestDialog, { data: { ...DIALOG, people: [] } }));
    expect(empty).toContain("Add the client to the matter first.");
    expect(empty).toContain('data-matter="m-1" disabled="">Send request</button>');
  });

  it("renders with the matter's dialogs only when offered", () => {
    expect(renderToStaticMarkup(createElement(MatterDialogs, { data: { ...DIALOGS, request: DIALOG } }))).toContain('id="dReq"');
    expect(renderToStaticMarkup(createElement(MatterDialogs, { data: DIALOGS }))).not.toContain("dReq");
  });

  it("opens it from the header's Request document; otherwise the button keeps going to the Documents tab", () => {
    const WIRE = { organizationId: "org-1", matterId: "m-1", version: 7 };
    const header = (extra: object) => renderToStaticMarkup(createElement(MatterTopBar, { data: { client: { name: "Dana Lee" }, pills: [], hold: null, tab: "overview", ...extra } }));
    expect(header({ wire: WIRE, request: true })).toContain('<button class="btn p sm" data-open="dReq">');
    expect(header({ wire: WIRE, request: false })).toContain('<button class="btn p sm" data-goto-tab="documents">');
    expect(header({})).toContain('<button class="btn p sm"><svg');
  });
});
