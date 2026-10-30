import { encode as encodeJpeg } from "jpeg-js";
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, StandardFonts, decodePDFRawStream, rgb, type PDFPage, type PDFRef } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { redactDocument, RedactionError } from "@/modules/documents/redact";

/** Page layouts the redaction must follow: CropBox, inherited Resources, text rise and the " operator. */

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

/** The file's bytes plus every stream decoded, for searching. */
async function everyByte(bytes: Uint8Array): Promise<string> {
  const parts = [Buffer.from(bytes).toString("latin1")];
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) {
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

function appears(haystack: string, secret: string): boolean {
  const upper = haystack.toUpperCase();
  return upper.includes(secret.toUpperCase()) || upper.includes(Buffer.from(secret).toString("hex").toUpperCase());
}

async function imageSamples(bytes: Uint8Array): Promise<{ width: number; height: number; rgb: Uint8Array }[]> {
  const pdf = await PDFDocument.load(bytes);
  const found: { width: number; height: number; rgb: Uint8Array }[] = [];
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    if (object.dict.lookup(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    const width = object.dict.lookup(PDFName.of("Width"));
    const height = object.dict.lookup(PDFName.of("Height"));
    if (width instanceof PDFNumber && height instanceof PDFNumber) found.push({ width: width.asNumber(), height: height.asNumber(), rgb: decodePDFRawStream(object).decode() });
  }
  return found;
}

type Literal = Parameters<PDFDocument["context"]["obj"]>[0];

/** A page with hand-written content and Helvetica as /F1 on the page itself. */
async function contentPdf(content: string, extraFonts: Record<string, Literal> = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([200, 200]);
  const fonts: Record<string, PDFRef> = { F1: font.ref };
  for (const [name, dict] of Object.entries(extraFonts)) fonts[name] = pdf.context.register(pdf.context.obj(dict));
  page.node.set(PDFName.of("Resources"), pdf.context.obj({ Font: fonts }));
  page.node.set(PDFName.of("Contents"), pdf.context.register(pdf.context.stream(content)));
  return pdf.save();
}

describe("redaction follows the page layout", () => {
  it("maps marks against the CropBox, as the viewer shows the page", async () => {
    const secret = "CROPPED-SECRET-417";
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page: PDFPage = pdf.addPage([400, 400]);
    page.drawText(secret, { x: 220, y: 220, size: 12, font, color: rgb(0, 0, 0) });
    page.drawText(KEPT, { x: 220, y: 370, size: 12, font, color: rgb(0, 0, 0) });
    page.setCropBox(200, 200, 200, 200);
    const bytes = await pdf.save();
    expect(appears(await everyByte(bytes), secret)).toBe(true);

    // Bottom quarter of the visible (cropped) page: user space y 200..250.
    const out = await redactDocument(bytes, "application/pdf", [{ page: 0, x: 0, y: 0.75, width: 1, height: 0.25 }]);
    const after = await everyByte(out);
    expect(appears(after, secret)).toBe(false);
    expect(appears(after, KEPT)).toBe(true);
  });

  it("uses Resources inherited from the Pages tree, for the page and for a form without its own", async () => {
    const formSecret = "FORM-SECRET-628";
    const photo = jpeg(40, 30, (_x, y) => (y < 15 ? [255, 0, 0] : [0, 0, 255]));
    const pdf = await PDFDocument.create();
    const image = await pdf.embedJpg(photo);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const form = pdf.context.register(
      pdf.context.stream(`q 40 0 0 30 0 0 cm /Img Do Q BT /F1 6 Tf 2 2 Td (${formSecret}) Tj ET`, { Type: "XObject", Subtype: "Form", BBox: [0, 0, 40, 30] }),
    );
    const page = pdf.addPage([40, 30]);
    page.node.delete(PDFName.of("Resources"));
    pdf.catalog.Pages().set(PDFName.of("Resources"), pdf.context.obj({ XObject: { Img: image.ref, Fm: form }, Font: { F1: font.ref } }));
    page.node.set(PDFName.of("Contents"), pdf.context.register(pdf.context.stream("/Fm Do")));
    const bytes = await pdf.save();

    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPage(0).node.get(PDFName.of("Resources"))).toBeUndefined();
    expect(Buffer.from(bytes).includes(Buffer.from(photo))).toBe(true);
    expect(appears(await everyByte(bytes), formSecret)).toBe(true);

    const out = await redactDocument(bytes, "application/pdf", [{ page: 0, x: 0, y: 0.5, width: 1, height: 0.5 }]);
    expect(Buffer.from(out).includes(Buffer.from(photo))).toBe(false);
    expect(appears(await everyByte(out), formSecret)).toBe(false);
    const sample = (await imageSamples(out)).find((item) => item.width === 40 && item.height === 30);
    expect(sample).toBeDefined();
    const top = sample?.rgb.subarray(0, 40 * 3) ?? new Uint8Array();
    const bottom = sample?.rgb.subarray(40 * 29 * 3, 40 * 30 * 3) ?? new Uint8Array();
    expect(top[0]).toBeGreaterThan(200);
    expect(Math.max(...bottom)).toBe(0);
  });

  it("refuses to make a copy when an XObject painted on the page can't be found", async () => {
    const bytes = await contentPdf("q 200 0 0 200 0 0 cm /Missing Do Q");
    await expect(redactDocument(bytes, "application/pdf", [{ page: 0, x: 0, y: 0, width: 0.5, height: 0.5 }])).rejects.toBeInstanceOf(RedactionError);
  });

  it("removes raised text (Ts) under the mark and keeps the baseline text", async () => {
    const secret = "RISE-SECRET-205";
    const bytes = await contentPdf(`BT /F1 12 Tf 20 20 Td 100 Ts (${secret}) Tj ET BT /F1 12 Tf 20 20 Td 0 Ts (${KEPT}) Tj ET`);
    // User space y 110..140, where the raised text is drawn.
    const out = await redactDocument(bytes, "application/pdf", [{ page: 0, x: 0, y: 0.3, width: 1, height: 0.15 }]);
    const after = await everyByte(out);
    expect(appears(after, secret)).toBe(false);
    expect(appears(after, KEPT)).toBe(true);
  });

  it("places text shown with \" on the next line and with its word and character spacing", async () => {
    const secret = "QUOTE-SECRET-38";
    const bytes = await contentPdf(`BT /F1 12 Tf 30 TL 5 100 Td 0 12 (${secret}) " ET BT /F1 12 Tf 20 20 Td (${KEPT}) Tj ET`);
    // Next line is y 70; with 12pt character spacing the later glyphs reach x 150..200.
    const out = await redactDocument(bytes, "application/pdf", [{ page: 0, x: 0.75, y: 0.6, width: 0.25, height: 0.1 }]);
    const after = await everyByte(out);
    expect(appears(after, secret)).toBe(false);
    expect(appears(after, KEPT)).toBe(true);
  });

  it("refuses Type3 fonts and vertical writing it can't position", async () => {
    const type3 = { Type: "Font", Subtype: "Type3", FontBBox: [0, 0, 1000, 1000], FontMatrix: [0.001, 0, 0, 0.001, 0, 0], CharProcs: {}, Encoding: "WinAnsiEncoding", FirstChar: 65, LastChar: 65, Widths: [1000] };
    const vertical = { Type: "Font", Subtype: "Type0", BaseFont: "Vertical", Encoding: "Identity-V" };
    const region = [{ page: 0, x: 0, y: 0, width: 1, height: 1 }];
    const withType3 = await contentPdf("BT /F3 12 Tf 20 100 Td (A) Tj ET", { F3: type3 });
    await expect(redactDocument(withType3, "application/pdf", region)).rejects.toBeInstanceOf(RedactionError);
    const withVertical = await contentPdf("BT /F4 12 Tf 20 100 Td <0001> Tj ET", { F4: vertical });
    await expect(redactDocument(withVertical, "application/pdf", region)).rejects.toBeInstanceOf(RedactionError);
    // A horizontal Type0 font is still redacted.
    const horizontalFont = { Type: "Font", Subtype: "Type0", BaseFont: "Vertical", Encoding: "Identity-H" };
    const horizontal = await contentPdf("BT /F5 12 Tf 20 100 Td <0001> Tj ET", { F5: horizontalFont });
    await expect(redactDocument(horizontal, "application/pdf", region)).resolves.toBeInstanceOf(Uint8Array);
  });
});
