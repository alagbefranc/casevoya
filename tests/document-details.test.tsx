import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetDocuments } from "@/components/sheet/designer/documents";
import { documentError as documentErrorText } from "@/modules/documents/errors";
import { documentDetails, languageLabel } from "@/modules/sheet/documents-present";

// DOC-06 (#178): an All documents card's Details for a reviewer: matters using it, use in another
// matter, translation, type, sensitivity and expiry. Synthetic records only.

const names: Record<string, string> = { m1: "ON-2026-0002", m2: "ON-2026-0008", m3: "ON-2026-0011" };
const matterName = (id: string) => names[id] ?? "Matter";

const base = {
  organizationId: "o1",
  document: { id: "d1", purpose: "Bank statement", sensitivity: "ordinary", version: 3, personId: "p1" },
  person: "Francis Alagbe",
  version: { id: "v1", rowVersion: 5, expiresOn: null, uploadState: "clean", translationOf: null, languageTag: null },
  refs: [{ id: "r1", matterId: "m1" }],
  personMatters: ["m1", "m2", "m3", "m2"],
  others: [
    { versionId: "v2", title: "Passport bio page", translationOf: null, languageTag: null },
    { versionId: "v3", title: "Bank statement (French)", translationOf: "v1", languageTag: "fr" },
  ],
  matterName,
};

describe("document details", () => {
  it("lists the matters using it, the person's other matters to use it on, and its translations", () => {
    const details = documentDetails(base);
    expect(details.refs).toEqual([{ id: "r1", label: "ON-2026-0002" }]);
    expect(details.candidates).toEqual([
      { id: "m2", label: "ON-2026-0008" },
      { id: "m3", label: "ON-2026-0011" },
    ]);
    expect(details.linkNote).toBeNull();
    // A document that translates this one is not offered as its original.
    expect(details.originals).toEqual([{ versionId: "v2", label: "Passport bio page" }]);
    expect(details.translations).toEqual(["Bank statement (French) (French)"]);
    expect(languageLabel("en")).toBe("English");
  });

  it("offers no other matter for a file that hasn't passed its check, and says why", () => {
    const details = documentDetails({ ...base, version: { ...base.version, uploadState: "quarantined" } });
    expect(details.candidates).toEqual([]);
    expect(details.linkNote).toBe("Only a file that passed its check can be used on another matter.");
    expect(documentDetails({ ...base, personMatters: ["m1"] }).linkNote).toBe("Francis Alagbe isn’t on another matter you can open.");
  });

  it("renders a Details button on the card and one dialog on the page, only for a reviewer's cards", () => {
    const details = documentDetails(base);
    const card = { title: "Bank statement", thumb: { icon: "file-pdf" }, meta: { parts: ["ON-2026-0002", "Francis"] }, states: [{ tone: "ok" as const, label: "Accepted" }] };
    const html = renderToStaticMarkup(createElement(SheetDocuments, { data: { tab: "all", pills: [], firmName: "Test Firm", all: { cards: [{ ...card, details }] } } }));
    expect(html).toContain('aria-label="Details of Bank statement"');
    expect(html).toContain("data-doc-details=");
    expect(html).toContain('<dialog class="dlg wide" id="dDocDetails"');
    expect(html).toContain("Removing it from a matter never deletes the file.");
    const plain = renderToStaticMarkup(createElement(SheetDocuments, { data: { tab: "all", pills: [], firmName: "Test Firm", all: { cards: [card] } } }));
    expect(plain).not.toContain("dDocDetails");
    expect(plain).not.toContain("data-doc-details");
  });

  it("words the new refusals", () => {
    expect(documentErrorText("the document's person is not on that matter")).toBe("That person isn’t on the matter you chose.");
    expect(documentErrorText("only a file that passed its check can be used on another matter")).toBe("Only a file that passed its check can be used on another matter.");
    expect(documentErrorText("choose the translation's language")).toBe("Choose the translation’s language.");
  });
});
