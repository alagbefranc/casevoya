import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClientsHeader, type ClientsData } from "@/components/sheet/designer/clients";
import { MatterDialogs, MatterPeople, type MatterDialogsData } from "@/components/sheet/designer/matter";
import { PersonEditDialog, personEditProps } from "@/components/sheet/designer/person-edit";
import { birthHint, editNotes, mayOfferPersonEdit, minorOn, personEditData, readPersonEdit, readPhone } from "@/modules/sheet/edit-person";

const PERSON = "6f0c1d1e-8a3f-4b55-9d61-3b1d2c4e5f60";
const ORG = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TODAY = "2026-10-18";

const BASE = { personId: PERSON, version: 3, name: "Ana Pereira", email: "", phone: "", dateOfBirth: "", today: TODAY };

describe("reading Edit details", () => {
  it("accepts a name alone and normalizes what is typed", () => {
    expect(readPersonEdit({ ...BASE, name: "  Ana   Pereira " })).toEqual({
      input: { personId: PERSON, version: 3, displayName: "Ana Pereira", email: null, phone: null, dateOfBirth: null },
    });
    expect(readPersonEdit({ ...BASE, email: " Ana@Example.TEST ", phone: "+1 (416) 555-0100", dateOfBirth: "1990-04-04" })).toEqual({
      input: { personId: PERSON, version: 3, displayName: "Ana Pereira", email: "ana@example.test", phone: "+14165550100", dateOfBirth: "1990-04-04" },
    });
  });

  it("needs a name of at most 200 characters", () => {
    expect(readPersonEdit({ ...BASE, name: "  " })).toEqual({ error: "Add their name." });
    expect(readPersonEdit({ ...BASE, name: "a".repeat(201) })).toEqual({ error: "Shorten the name to 200 characters or fewer." });
  });

  it("refuses a malformed email", () => {
    for (const email of ["ana", "ana@", "ana@example", "a b@example.test", `${"a".repeat(320)}@example.test`]) {
      expect(readPersonEdit({ ...BASE, email })).toEqual({ error: "Enter a valid email address." });
    }
  });

  it("wants an E.164 phone number with its country code", () => {
    expect(readPhone("")).toEqual({ phone: null });
    expect(readPhone("+44 20 7946 0958")).toEqual({ phone: "+442079460958" });
    expect(readPhone("416 555 0100")).toEqual({ error: "Add the phone number with its country code, starting with +." });
    expect(readPhone("+0 416 555 0100")).toEqual({ error: "Enter a valid phone number, like +1 416 555 0100." });
    expect(readPhone("+1 555")).toEqual({ error: "Enter a valid phone number, like +1 416 555 0100." });
    expect(readPhone("+1 416 555 0100 0100 01")).toEqual({ error: "Enter a valid phone number, like +1 416 555 0100." });
    expect(readPhone("+1 416 CALL NOW")).toEqual({ error: "Enter a valid phone number, like +1 416 555 0100." });
  });

  it("refuses a date of birth in the future, before 1900, or not a real date", () => {
    expect(readPersonEdit({ ...BASE, dateOfBirth: "2026-10-19" })).toEqual({ error: "The date of birth can’t be in the future." });
    expect(readPersonEdit({ ...BASE, dateOfBirth: "1899-12-31" })).toEqual({ error: "Check the date of birth. It is before 1900." });
    expect(readPersonEdit({ ...BASE, dateOfBirth: "1990-02-30" })).toEqual({ error: "Enter the date of birth as a full date." });
    expect(readPersonEdit({ ...BASE, dateOfBirth: TODAY })).toMatchObject({ input: { dateOfBirth: TODAY } });
  });

  it("only saves for a known person and version", () => {
    expect(readPersonEdit({ ...BASE, personId: "nope" })).toEqual({ error: "Open Edit details from a person on this page." });
    expect(readPersonEdit({ ...BASE, version: "" })).toEqual({ error: "Open Edit details from a person on this page." });
    expect(readPersonEdit({ ...BASE, version: 0 })).toEqual({ error: "Open Edit details from a person on this page." });
  });
});

describe("Edit details helpers", () => {
  const record = { id: PERSON, version: 2, display_name: "Ana Pereira", email: null, contact_phone: null, date_of_birth: null, birth_date_precision: null };

  it("prefills a full date only, and says what a partial one is", () => {
    expect(personEditData(ORG, { ...record, date_of_birth: "1990-04-04", birth_date_precision: "day" })).toMatchObject({ dateOfBirth: "1990-04-04", partialBirth: null });
    const year = personEditData(ORG, { ...record, date_of_birth: "1990-01-01", birth_date_precision: "year" });
    expect(year).toMatchObject({ dateOfBirth: "", partialBirth: "1990" });
    expect(birthHint(year)).toBe("On file as 1990 only. Enter the full date, or leave it blank to keep that.");
    expect(birthHint(personEditData(ORG, record))).toBe("Optional. Only adults get a portal login.");
  });

  it("works out a minor the way app.derive_is_minor does for a full date", () => {
    expect(minorOn("2008-10-19", 18, TODAY)).toBe(true);
    expect(minorOn("2008-10-18", 18, TODAY)).toBe(false);
    expect(minorOn("2008-10-18", 19, TODAY)).toBe(true);
  });

  it("offers editing to roles the database can let edit people", () => {
    for (const role of ["firm_owner", "licensed_consultant", "case_manager", "assistant"]) expect(mayOfferPersonEdit(role)).toBe(true);
    for (const role of ["finance", "client", "platform_admin"]) expect(mayOfferPersonEdit(role)).toBe(false);
  });

  it("says when a save changed who counts as an adult", () => {
    expect(editNotes({ becameAdult: false, becameMinor: false })).toEqual([]);
    expect(editNotes({ becameAdult: true, becameMinor: false })[0]).toMatch(/majority review/);
    expect(editNotes({ becameAdult: false, becameMinor: true })[0]).toMatch(/minor/);
  });
});

const EDIT = personEditData(ORG, { id: PERSON, version: 4, display_name: "Ana Pereira", email: "ana@example.test", contact_phone: "+14165550100", date_of_birth: "1990-04-04", birth_date_precision: "day" });

describe("Edit details markup", () => {
  it("is the Designer's dialog with its .fld / .inp fields", () => {
    const html = renderToStaticMarkup(createElement(PersonEditDialog, { data: { maxBirthDate: TODAY } }));
    expect(html).toMatch(/^<dialog class="dlg" id="dlgPE" aria-labelledby="dlgPEH"><div class="dh"><h2 id="dlgPEH">Edit details<\/h2><button class="x"/);
    expect(html).toContain('<div class="fld"><label for="peN">Name</label><input class="inp" id="peN" type="text"');
    expect(html).toContain('<input class="inp" id="peD" type="date" autoComplete="off" aria-describedby="peD-h" min="1900-01-01" max="2026-10-18"/>');
    expect(html).toContain('<button class="btn p" data-person-save="1">Save details</button>');
    expect(html).not.toContain("data-edit-invite");
    expect(renderToStaticMarkup(createElement(PersonEditDialog, { data: { maxBirthDate: TODAY, invite: true } }))).toContain(
      '<button class="btn" data-edit-invite="1" hidden="">Invite to the portal</button>',
    );
  });

  it("carries the person on the opener, not in the page's markup", () => {
    expect(personEditProps(EDIT)).toEqual({
      "data-edit-open": "1",
      "data-org": ORG,
      "data-person": PERSON,
      "data-version": "4",
      "data-name": "Ana Pereira",
      "data-email": "ana@example.test",
      "data-phone": "+14165550100",
      "data-birth": "1990-04-04",
      "data-birth-hint": "Correct it if it’s wrong. It decides who counts as an adult.",
    });
  });

  const header: Pick<ClientsData, "tab" | "counts" | "add" | "tabs"> = {
    tab: "person",
    counts: { people: 1, households: 0 },
    add: { href: "/sheet/matters?new=1", label: "Add a client" },
    tabs: { person: "Ana Pereira", household: "Household" },
  };

  it("adds Edit details to the Clients person tab's top bar only when given", () => {
    const plain = renderToStaticMarkup(createElement(ClientsHeader, { data: header }));
    expect(plain).not.toContain("Edit details");
    const html = renderToStaticMarkup(createElement(ClientsHeader, { data: { ...header, edit: EDIT } }));
    expect(html).toContain(`<button class="btn s sm" data-edit-open="1" data-org="${ORG}" data-person="${PERSON}"`);
    expect(html).toContain('#i-edit"></use></svg>Edit details</button><a class="btn p sm" href="/sheet/matters?new=1">');
    expect(renderToStaticMarkup(createElement(ClientsHeader, { data: { ...header, tab: "dir", edit: EDIT } }))).toBe(
      renderToStaticMarkup(createElement(ClientsHeader, { data: { ...header, tab: "dir" } })),
    );
  });

  const card = { person: { name: "Ana Pereira" }, role: "Principal applicant", parts: ["ana@example.test"], pill: { label: "No portal access" } };

  it("opens Edit details from a People card's Manage button, with the invitation offered inside", () => {
    const html = renderToStaticMarkup(
      createElement(MatterPeople, {
        cards: [{ ...card, edit: EDIT, invite: { personId: PERSON, role: "Applicant", email: "ana@example.test", birthDateMissing: true } }],
        relationships: [],
      }),
    );
    expect(html).toContain(`aria-label="Manage Ana Pereira" data-edit-open="1" data-org="${ORG}" data-person="${PERSON}" data-version="4"`);
    expect(html).toContain('data-role="Applicant" data-dob="missing"><svg');
    expect(html).not.toContain("data-invite-open");
  });

  it("adds the dialog to the matter dialogs only when the page passes it", () => {
    const dialogs: MatterDialogsData = { current: 2, target: 3, version: 1, evidence: [], reason: "", owners: [{ name: "Dana Lee" }], reviewOn: "2026-10-30", receivedOn: TODAY };
    expect(renderToStaticMarkup(createElement(MatterDialogs, { data: dialogs }))).not.toContain("dlgPE");
    expect(renderToStaticMarkup(createElement(MatterDialogs, { data: { ...dialogs, edit: { maxBirthDate: TODAY, invite: true } } }))).toContain('id="dlgPE"');
  });
});
