import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetClients, type PersonData } from "@/components/sheet/designer/clients";
import { SheetMigration } from "@/components/sheet/designer/migration";
import { documentsIrreversibleConfirm, documentsIrreversibleNotice, DOCUMENTS_IRREVERSIBLE_TITLE } from "@/modules/migration/irreversible";
import { mixedFileMessage, mixedKinds } from "@/modules/migration/one-kind";
import { readProvenance } from "@/modules/migration/provenance";
import { importedDocumentKind, importedEvidence, importedNote, importedOrigin, importedRelationship } from "@/modules/sheet/imported-present";
import { migrationError } from "@/modules/sheet/migration-present";

/** MIG follow-ups (gap #187): provenance on more records, the documents warning, one kind per file. Synthetic data only. */

const TZ = "America/Toronto";

const imports = readProvenance([
  { id: "d1", system: "Synthetic Old CRM", imported_at: "2026-10-25T16:00:00Z", original_at: "2019-03-04T05:00:00Z", reference: null, created: true, version_at_import: 1 },
  { id: "r1", system: "Synthetic Old CRM", imported_at: "2026-10-25T16:00:00Z", original_at: null, reference: null, created: true, version_at_import: 1 },
]);
const LINE = "Imported from Synthetic Old CRM on 25 Oct 2026 (originally 4 Mar 2019)";
const PLAIN = "Imported from Synthetic Old CRM on 25 Oct 2026";

describe("MIG follow-ups: Imported from <system> on <date> on key dates, documents, relationships and opening balances", () => {
  it("adds the import to a key date's origin, and leaves a native key date as it was", () => {
    expect(importedOrigin("Not derived from a rule.", imports.get("d1"), TZ)).toBe(`Not derived from a rule. ${LINE}.`);
    expect(importedOrigin("Derived from a program rule.", undefined, TZ)).toBe("Derived from a program rule.");
  });

  it("shows where an imported document came from under its name", () => {
    expect(importedDocumentKind("Added to the file", imports.get("d1"), TZ)).toBe(LINE);
    expect(importedDocumentKind("Requested by the firm", null, TZ)).toBe("Requested by the firm");
  });

  it("puts a relationship's import in its Evidence cell on the matter, and beside its label on the person", () => {
    expect(importedEvidence("—", imports.get("r1"), TZ)).toBe(PLAIN);
    expect(importedEvidence("—", undefined, TZ)).toBe("—");
    expect(importedRelationship("Spouse", imports.get("r1"), TZ)).toEqual({ left: "Spouse", right: PLAIN });
    expect(importedRelationship("Spouse", undefined, TZ)).toBe("Spouse");
  });

  it("gives an opening balance (or a document card) its line by id, and nothing for a record no import brought in", () => {
    expect(importedNote(imports, "d1", TZ)).toBe(LINE);
    expect(importedNote(imports, "nope", TZ)).toBeNull();
  });

  it("renders an imported relationship on the person view with the Designer's separator", () => {
    const data: PersonData = {
      name: "Synthetic Person",
      summary: "Applicant",
      facts: [],
      superseded: null,
      relationships: { rows: [{ person: { name: "Synthetic Spouse" }, label: importedRelationship("Spouse", imports.get("r1"), TZ) }], note: "Synthetic note." },
      matters: { rows: [], note: [] },
      preferences: null,
    };
    const html = renderToStaticMarkup(
      createElement(SheetClients, { data: { tab: "person", counts: { people: 1, households: 0 }, add: null, tabs: { person: "Synthetic Person", household: "Household" }, person: data } }),
    );
    expect(html).toContain("Spouse");
    expect(html).toContain(PLAIN);
  });

  it("renders an opening balance's provenance under its matter on Sign off", () => {
    const html = renderToStaticMarkup(
      createElement(SheetMigration, {
        data: {
          tab: "signoff",
          signoff: {
            summary: [],
            action: null,
            balances: [
              { key: "b1", matter: "SYN-1", kind: "Receivable", amount: "$125.00 CAD", asOf: "2026-09-30", state: { tone: "chg", label: "Pending review" }, actions: [], imported: LINE },
              { key: "b2", matter: "SYN-2", kind: "Receivable", amount: "$50.00 CAD", asOf: "2026-09-30", state: { tone: "chg", label: "Pending review" }, actions: [] },
            ],
          },
        },
      }),
    );
    expect(html).toContain(`<td>SYN-1<span class="mu" style="display:block;font-size:12px">${LINE}</span></td>`);
    expect(html).toContain("<td>SYN-2</td>");
  });
});

describe("MIG decision 7: a documents import can't be undone", () => {
  it("says so plainly at the pilot, the pilot's sign-off and the full run", () => {
    for (const step of ["pilot", "signoff", "full"] as const) {
      const notice = documentsIrreversibleNotice(step);
      expect(notice.tone).toBe("bad");
      expect(notice.title).toBe("Documents can’t be removed by rolling back this import");
      expect(documentsIrreversibleConfirm(step)).toMatch(/^Documents can’t be removed by rolling back this import/);
    }
    expect(documentsIrreversibleNotice("signoff").copy).toMatch(/^Check the pilot’s files before you sign off\./);
    expect(documentsIrreversibleConfirm("signoff")).toBe("Documents can’t be removed by rolling back this import. Check the pilot’s files before you sign off.");
  });

  it("renders the warning on Sign off from the Designer's alert, beside the step's own notice", () => {
    const html = renderToStaticMarkup(
      createElement(SheetMigration, {
        data: {
          tab: "signoff",
          signoff: {
            summary: [],
            action: { label: "Sign off the pilot", attrs: { "data-mig-act": "signoff", "data-kind": "documents" } },
            notice: { tone: "warn", title: "The full import waits for your sign-off", copy: "Check the records below." },
            undo: documentsIrreversibleNotice("signoff"),
          },
        },
      }),
    );
    expect(html).toContain('<div class="alert warn rv"');
    expect(html).toContain(`<div class="alert bad rv" role="note" data-mig-undo=""`);
    expect(html).toContain(`<b>${DOCUMENTS_IRREVERSIBLE_TITLE}</b>Check the pilot’s files before you sign off.`);
    // Without the warning the tab is as before.
    const plain = renderToStaticMarkup(createElement(SheetMigration, { data: { tab: "signoff", signoff: { summary: [], action: null } } }));
    expect(plain).not.toContain("data-mig-undo");
  });
});

describe("MIG decision 2: one kind per file", () => {
  const refusal = "this file holds more than one kind of record: Tasks; Key dates";

  it("names the kinds the database found and says how to split the file", () => {
    expect(mixedKinds(refusal)).toEqual(["Tasks", "Key dates"]);
    expect(mixedKinds("this file holds more than one kind of record: Clients and matters; Notes; Tasks")).toEqual(["Clients and matters", "Notes", "Tasks"]);
    expect(mixedFileMessage(refusal)).toBe(
      "This file holds more than one kind of record: Tasks and Key dates. Nothing was imported. Import one kind per file: copy each kind’s columns, with the matter reference or person they belong to, into its own CSV and upload each one with “What’s in the file” set to that kind. Import clients and matters first.",
    );
    expect(mixedFileMessage("this file holds more than one kind of record: Clients and matters; Notes; Tasks")).toContain("Clients and matters, Notes and Tasks.");
    expect(mixedFileMessage("map a column to each required field")).toBeNull();
  });

  it("is what the import page shows for the refusal, at upload and at Map columns", () => {
    expect(migrationError(`${refusal}\nSQL: select ...`)).toMatch(/^This file holds more than one kind of record: Tasks and Key dates\./);
  });
});
