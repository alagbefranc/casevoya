import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { SheetDocuments } from "@/components/sheet/designer/documents";
import { latin1, PREVIEWABLE, previewStamp, watermarkedPreview } from "@/modules/documents/preview";
import { custodyRows, type CustodyEvent } from "@/modules/sheet/documents-present";

// DOC-07 (#178): the secure preview's watermark, and Originals we hold as custody steps.
// Synthetic records only.

// A 1x1 white PNG.
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64"));

describe("secure preview", () => {
  it("stamps the viewer and time on every page of a PDF, and leaves the page count alone", async () => {
    const source = await PDFDocument.create();
    source.addPage([600, 800]);
    source.addPage([600, 800]);
    const stamp = previewStamp("Dana Staff", new Date("2026-10-24T14:05:00Z"));
    expect(stamp).toBe("Dana Staff · 24 Oct 2026, 14:05 UTC · Casevoya preview, not the original");
    const out = await watermarkedPreview(await source.save(), "application/pdf", stamp);
    expect(out).not.toBeNull();
    const read = await PDFDocument.load(out as Uint8Array);
    expect(read.getPageCount()).toBe(2);
    expect(read.getTitle()).toBe("Casevoya preview");
  });

  it("puts an image on a page of its own, and refuses what it can't read", async () => {
    const out = await watermarkedPreview(PNG, "image/png", "Dana Staff");
    expect((await PDFDocument.load(out as Uint8Array)).getPageCount()).toBe(1);
    expect(await watermarkedPreview(Uint8Array.from([1, 2, 3]), "application/pdf", "x")).toBeNull();
    expect(await watermarkedPreview(PNG, "image/heic", "x")).toBeNull();
    expect(PREVIEWABLE.has("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(false);
    expect(latin1("Олена Dana")).toBe("????? Dana");
  });
});

const event = (kind: string | null, at: string, extra: Partial<CustodyEvent> = {}): CustodyEvent => ({
  versionId: "v1",
  kind,
  receivedOn: null,
  location: null,
  purpose: "Certified copy for the application",
  recipient: null,
  returnOn: null,
  acknowledgedAt: null,
  createdAt: at,
  ...extra,
});

const describeDoc = (id: string) => (id === "v1" ? { original: "Passport", owner: "Francis Alagbe" } : null);
const dayOf = (iso: string) => iso.slice(5, 10);

describe("originals we hold", () => {
  it("shows one row per original with where it is now, its return and acknowledgement, and the next steps", () => {
    const held = custodyRows([event("received", "2026-10-20T09:00:00Z", { receivedOn: "2026-10-20", location: "Safe A" }), event("moved", "2026-10-21T09:00:00Z", { location: "Safe B" })], describeDoc, dayOf);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ original: "Passport", received: "10-20", location: "Safe B", returnBy: "—", acknowledged: { tone: "chg", label: "Waiting" }, next: ["moved", "returned"] });
    expect(held[0].history).toEqual(["Received 10-20, kept in Safe A", "Moved to Safe B, 10-21"]);

    const back = custodyRows(
      [
        event("received", "2026-10-20T09:00:00Z", { receivedOn: "2026-10-20", location: "Safe A" }),
        event("returned", "2026-10-24T09:00:00Z", { recipient: "Francis Alagbe", returnOn: "2026-10-24" }),
        event("acknowledged", "2026-10-24T10:00:00Z", { recipient: "Francis Alagbe", acknowledgedAt: "2026-10-24T10:00:00Z" }),
      ],
      describeDoc,
      dayOf,
    )[0];
    expect(back).toMatchObject({ location: ["Returned", "Francis Alagbe"], returnBy: ["Returned", "10-24"], acknowledged: "Signed by Francis Alagbe, 10-24", next: [] });
    // A row recorded before steps existed keeps its own fields and offers no steps.
    expect(custodyRows([event(null, "2026-10-01T09:00:00Z", { receivedOn: "2026-10-01", location: "Safe", returnOn: "2026-11-01" })], describeDoc, dayOf)[0]).toMatchObject({ returnBy: "11-01", next: [] });
  });

  it("adds Record an original, the Custody column and the dialog only when live", () => {
    const rows = custodyRows([event("received", "2026-10-20T09:00:00Z", { receivedOn: "2026-10-20", location: "Safe A" })], describeDoc, dayOf).map(({ versionId, next, history, ...row }) => ({ ...row, step: { versionId, organizationId: "o1", next }, history }));
    const live = renderToStaticMarkup(createElement(SheetDocuments, { data: { tab: "custody", pills: [], firmName: "Test Firm", custody: { rows, record: { organizationId: "o1", originals: [{ versionId: "v1", label: "Passport · Francis Alagbe · ON-2026-0002" }] } } } }));
    expect(live).toContain('data-custody-open="received" data-org="o1"');
    expect(live).toContain('data-custody-open="returned" data-version="v1"');
    expect(live).toContain('<dialog class="dlg" id="dCustody"');
    expect(live).toContain(">Custody</th>");
    const designer = renderToStaticMarkup(createElement(SheetDocuments, { data: { tab: "custody", pills: [], firmName: "Test Firm", custody: { rows: rows.map((row) => ({ original: row.original, owner: row.owner, received: row.received, location: row.location, purpose: row.purpose, returnBy: row.returnBy, acknowledged: row.acknowledged })) } } }));
    expect(designer).not.toContain("data-custody");
    expect(designer).not.toContain(">Custody</th>");
  });
});
