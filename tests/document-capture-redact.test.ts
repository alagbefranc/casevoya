import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { encode as encodeJpeg } from "jpeg-js";
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFString, StandardFonts, decodePDFRawStream, rgb } from "pdf-lib";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { PageList, type CapturePage } from "@/components/documents/page-capture";
import { assemblePages, placement } from "@/modules/documents/assemble";
import { assemblyPages, moveItem, nextTurn } from "@/modules/documents/capture";
import { redactDocument } from "@/modules/documents/redact";
import { displayedRectToUser } from "@/modules/documents/redact-geometry";

const SECRET = "SECRET-NAME-991";
const KEPT = "KEEP-THIS-VISIBLE";

function jpeg(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): Uint8Array {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = paint(x, y);
      const at = (y * width + x) * 4;
      data[at] = red;
      data[at + 1] = green;
      data[at + 2] = blue;
      data[at + 3] = 255;
    }
  }
  return Uint8Array.from(encodeJpeg({ data, width, height }, 100).data);
}

function png(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): Uint8Array {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = paint(x, y);
      const at = (y * width + x) * 4;
      image.data[at] = red;
      image.data[at + 1] = green;
      image.data[at + 2] = blue;
      image.data[at + 3] = 255;
    }
  }
  return PNG.sync.write(image);
}

async function textPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 200]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText(SECRET, { x: 20, y: 20, size: 12, font, color: rgb(0, 0, 0) });
  page.drawText(KEPT, { x: 20, y: 160, size: 12, font, color: rgb(0, 0, 0) });
  return pdf.save();
}

async function imageSamples(bytes: Uint8Array): Promise<{ width: number; height: number; rgb: Uint8Array }[]> {
  const pdf = await PDFDocument.load(bytes);
  const found: { width: number; height: number; rgb: Uint8Array }[] = [];
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    if (object.dict.lookup(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    const width = object.dict.lookup(PDFName.of("Width"));
    const height = object.dict.lookup(PDFName.of("Height"));
    if (width instanceof PDFNumber && height instanceof PDFNumber) {
      found.push({ width: width.asNumber(), height: height.asNumber(), rgb: decodePDFRawStream(object).decode() });
    }
  }
  return found;
}

/** The file's bytes plus every stream decoded, for searching. */
async function everyByte(bytes: Uint8Array): Promise<string> {
  const parts = [Buffer.from(bytes).toString("latin1")];
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) {
      // Objects that were inside a compressed object stream.
      parts.push(object.toString());
      continue;
    }
    try {
      parts.push(Buffer.from(decodePDFRawStream(object).decode()).toString("latin1"));
    } catch {
      parts.push(Buffer.from(object.contents).toString("latin1"));
    }
  }
  return parts.join("\n");
}

/** As text, as hex, or as UTF-16BE hex (how pdf-lib stores field values). */
function appears(haystack: string, secret: string): boolean {
  const upper = haystack.toUpperCase();
  const utf16 = Buffer.from(secret, "utf16le").swap16().toString("hex").toUpperCase();
  return upper.includes(secret.toUpperCase()) || upper.includes(Buffer.from(secret).toString("hex").toUpperCase()) || upper.includes(utf16);
}

describe("capture and redaction controls", () => {
  it("offers rotate, reorder and remove on each page, with a 44px target", () => {
    const page: CapturePage = { id: "p", previewUrl: "blob:page", rotation: 0, source: "camera", mediaType: "image/jpeg", bytes: new Uint8Array() };
    const html = renderToStaticMarkup(createElement(PageList, { pages: [page, { ...page, id: "q" }], onChange() {} }));
    expect(html).toContain("Rotate");
    expect(html).toContain('aria-label="Move page 2 earlier"');
    expect(html).toContain('aria-label="Remove page 1"');
    expect(html).toContain("min-height:44px");
  });
});

describe("camera assembly", () => {
  it("turns a page clockwise and keeps the JPEG bytes in the PDF", async () => {
    const photo = jpeg(40, 20, (x) => (x < 20 ? [255, 0, 0] : [0, 0, 255]));
    const turned = placement(40, 20, 90);
    expect(turned).toMatchObject({ pageWidth: 20, pageHeight: 40, rotate: -90 });
    expect(nextTurn(270)).toBe(0);
    expect(moveItem(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(assemblyPages([{ rotation: 90, source: "camera" }])).toEqual([{ rotation_degrees: 90, source: "camera" }]);

    const pdf = await assemblePages([
      { bytes: photo, mediaType: "image/jpeg", rotation: 0, source: "camera" },
      { bytes: photo, mediaType: "image/jpeg", rotation: 90, source: "library" },
    ]);
    expect(Buffer.from(pdf).includes(Buffer.from(photo))).toBe(true);
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getSize()).toEqual({ width: 40, height: 20 });
    expect(doc.getPage(1).getSize()).toEqual({ width: 20, height: 40 });
  });
});

describe("true redaction", () => {
  it("removes text under the box and leaves the rest of the page", async () => {
    const bytes = await textPdf();
    const snapshot = Buffer.from(bytes);
    const box = displayedRectToUser({ x: 0, y: 0.75, width: 1, height: 0.25 }, { x: 0, y: 0, width: 200, height: 200 }, 0);
    expect(box.y).toBeLessThan(40);
    const out = await redactDocument(bytes, "application/pdf", [{ page: 0, x: 0, y: 0.75, width: 1, height: 0.25 }]);
    expect(Buffer.from(bytes).equals(snapshot)).toBe(true);
    const raw = Buffer.from(out).toString("latin1").toUpperCase();
    const secretHex = Buffer.from(SECRET).toString("hex").toUpperCase();
    const keptHex = Buffer.from(KEPT).toString("hex").toUpperCase();
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain(secretHex);
    expect(raw.includes(KEPT) || raw.includes(keptHex)).toBe(true);
  });

  it("rewrites image samples under the box and does not keep the original JPEG", async () => {
    const photo = jpeg(40, 30, (_x, y) => (y < 15 ? [255, 0, 0] : [0, 0, 255]));
    const pdf = await PDFDocument.create();
    const image = await pdf.embedJpg(photo);
    const page = pdf.addPage([40, 30]);
    page.drawImage(image, { x: 0, y: 0, width: 40, height: 30 });
    const bytes = await pdf.save();
    const out = await redactDocument(bytes, "application/pdf", [{ page: 0, x: 0, y: 0, width: 1, height: 0.5 }]);
    expect(Buffer.from(out).includes(Buffer.from(photo))).toBe(false);
    const samples = await imageSamples(out);
    const sample = samples.find((item) => item.width === 40 && item.height === 30);
    expect(samples.map((item) => `${item.width}x${item.height}`)).toContain("40x30");
    const top = sample?.rgb.subarray(0, 40 * 3) ?? new Uint8Array();
    const bottom = sample?.rgb.subarray(40 * 15 * 3, 40 * 16 * 3) ?? new Uint8Array();
    expect(Math.max(...top)).toBe(0);
    expect(bottom[2]).toBeGreaterThan(200);
  });

  it("blacks out a PNG and returns a PNG whose old bytes are gone", async () => {
    const source = png(20, 20, (x, y) => (x < 10 && y < 10 ? [255, 0, 0] : [0, 180, 0]));
    const out = await redactDocument(source, "image/png", [{ page: 0, x: 0, y: 0, width: 0.5, height: 0.5 }]);
    expect(Buffer.from(out).equals(Buffer.from(source))).toBe(false);
    const image = PNG.sync.read(Buffer.from(out));
    expect(image.data[0]).toBe(0);
    expect(image.data[1]).toBe(0);
    expect(image.data[2]).toBe(0);
    const corner = (19 * 20 + 19) * 4;
    expect(image.data[corner + 1]).toBe(180);
  });

  it("removes form data, XFA, alternate text, structure, metadata, attachments and scripts from the copy", async () => {
    const secrets = {
      field: "FIELD-SECRET-552",
      fieldDefault: "FIELD-DEFAULT-553",
      outsideValue: "OUTSIDE-VALUE-554",
      xfa: "XFA-SECRET-773",
      actual: "ACTUAL-SECRET-334",
      alt: "ALT-SECRET-335",
      expansion: "EXPANSION-SECRET-336",
      property: "PROPS-SECRET-337",
      xmp: "XMP-SECRET-338",
      pageXmp: "PAGE-XMP-SECRET-345",
      piece: "PIECE-SECRET-346",
      info: "INFO-SECRET-339",
      embedded: "EMBED-SECRET-340",
      struct: "STRUCT-SECRET-341",
      script: "JS-SECRET-342",
    };
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([200, 200]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText(KEPT, { x: 20, y: 160, size: 12, font, color: rgb(0, 0, 0) });
    const form = pdf.getForm();
    const inside = form.createTextField("applicant.name");
    inside.setText(secrets.field);
    inside.addToPage(page, { x: 20, y: 10, width: 150, height: 20, font });
    inside.acroField.dict.set(PDFName.of("DV"), PDFString.of(secrets.fieldDefault));
    const outside = form.createTextField("office");
    outside.setText(secrets.outsideValue);
    outside.addToPage(page, { x: 20, y: 120, width: 150, height: 20, font });
    page.node.Resources()?.set(PDFName.of("Properties"), pdf.context.obj({ MC0: pdf.context.obj({ ActualText: PDFString.of(secrets.property) }) }));
    const marked = [
      `/Span <</ActualText (${secrets.actual}) /Alt (${secrets.alt})>> BDC 20 20 m 30 30 l S EMC`,
      `/Span <</E <${Buffer.from(secrets.expansion).toString("hex")}>>> BDC 20 20 m EMC`,
      "/Span /MC0 BDC 20 20 m EMC",
    ].join("\n");
    page.node.addContentStream(pdf.context.register(pdf.context.stream(marked)));
    pdf.catalog.set(PDFName.of("Metadata"), pdf.context.register(pdf.context.stream(`<x:xmpmeta>${secrets.xmp}</x:xmpmeta>`, { Type: "Metadata", Subtype: "XML" })));
    page.node.set(PDFName.of("Metadata"), pdf.context.register(pdf.context.flateStream(`<x:xmpmeta>${secrets.pageXmp}</x:xmpmeta>`, { Type: "Metadata", Subtype: "XML" })));
    page.node.set(PDFName.of("PieceInfo"), pdf.context.obj({ App: pdf.context.obj({ Private: PDFString.of(secrets.piece) }) }));
    pdf.catalog.set(
      PDFName.of("StructTreeRoot"),
      pdf.context.register(pdf.context.obj({ Type: "StructTreeRoot", K: pdf.context.obj({ S: "Figure", Alt: PDFString.of(secrets.struct) }) })),
    );
    pdf.catalog.set(PDFName.of("MarkInfo"), pdf.context.obj({ Marked: true }));
    pdf.catalog.set(PDFName.of("OpenAction"), pdf.context.obj({ S: "JavaScript", JS: PDFString.of(secrets.script) }));
    pdf.setTitle(secrets.info);
    await pdf.attach(Buffer.from(secrets.embedded), "notes.txt", { mimeType: "text/plain" });
    // pdf-lib's form API drops XFA, so it is added to the saved file without it.
    const withXfa = await PDFDocument.load(await pdf.save(), { updateMetadata: false });
    const acroForm = withXfa.catalog.lookup(PDFName.of("AcroForm"), PDFDict);
    acroForm.set(PDFName.of("XFA"), withXfa.context.register(withXfa.context.flateStream(`<xdp:xdp><data>${secrets.xfa}</data></xdp:xdp>`)));
    const bytes = await withXfa.save();

    const before = await everyByte(bytes);
    for (const secret of Object.values(secrets)) expect(appears(before, secret), `fixture has ${secret}`).toBe(true);

    const out = await redactDocument(bytes, "application/pdf", [{ page: 0, x: 0, y: 0.75, width: 1, height: 0.25 }]);
    const after = await everyByte(out);
    for (const [label, secret] of Object.entries(secrets)) {
      if (label === "outsideValue") continue;
      expect(appears(after, secret), secret).toBe(false);
    }

    const doc = await PDFDocument.load(out, { updateMetadata: false });
    for (const key of ["AcroForm", "StructTreeRoot", "MarkInfo", "Metadata", "OpenAction"]) expect(doc.catalog.has(PDFName.of(key)), key).toBe(false);
    expect(doc.context.trailerInfo.Info).toBeUndefined();
    for (const [, object] of doc.context.enumerateIndirectObjects()) {
      if (object instanceof PDFDict) for (const key of ["V", "DV", "XFA", "ActualText", "Alt", "EmbeddedFiles"]) expect(object.has(PDFName.of(key)), key).toBe(false);
    }
    // The unmarked area still shows: the kept text and the outside field's appearance.
    expect(appears(after, KEPT)).toBe(true);
    expect(appears(after, secrets.outsideValue)).toBe(true);
    const annots = doc.getPage(0).node.Annots();
    expect(annots?.size()).toBe(2);
    expect(after).toContain("/Span BMC");
  });

  it("refuses a PNG above the pixel cap from its header, before decoding it", async () => {
    const header = new Uint8Array(64);
    header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const view = new DataView(header.buffer);
    view.setUint32(16, 8000);
    view.setUint32(20, 6000);
    await expect(redactDocument(header, "image/png", [{ page: 0, x: 0, y: 0, width: 0.2, height: 0.2 }])).rejects.toThrow(/too large/);
  });

  it("refuses a type it cannot redact", async () => {
    await expect(redactDocument(new Uint8Array([1, 2, 3, 4]), "image/heic", [{ page: 0, x: 0, y: 0, width: 0.2, height: 0.2 }])).rejects.toThrow(/PDF, JPEG, or PNG/);
  });
});
