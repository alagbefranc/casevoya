import { PDFDocument, degrees } from "pdf-lib";
import { type CaptureSource, type QuarterTurn } from "@/modules/documents/capture";

/**
 * DOC-03: one PDF from camera or library pages. JPEG and PNG bytes are embedded as they are
 * (a JPEG is not recompressed; a PNG becomes lossless samples). Turning a page is a PDF
 * transform, so the stored image stays at the resolution the phone captured.
 */

export type AssemblyPage = {
  bytes: Uint8Array;
  mediaType: "image/jpeg" | "image/png";
  rotation: QuarterTurn;
  source: CaptureSource;
};

/**
 * Where pdf-lib draws the image. Operators are translate, then rotate (counterclockwise), then
 * scale, so the image's unit square lands upright inside the page.
 */
export function placement(width: number, height: number, turn: QuarterTurn): { pageWidth: number; pageHeight: number; x: number; y: number; rotate: number } {
  switch (turn) {
    case 0:
      return { pageWidth: width, pageHeight: height, x: 0, y: 0, rotate: 0 };
    case 90:
      return { pageWidth: height, pageHeight: width, x: 0, y: width, rotate: -90 };
    case 180:
      return { pageWidth: width, pageHeight: height, x: width, y: height, rotate: 180 };
    case 270:
      return { pageWidth: height, pageHeight: width, x: height, y: 0, rotate: 90 };
    default: {
      const never: never = turn;
      throw new Error(`Unexpected rotation ${String(never)}`);
    }
  }
}

export async function assemblePages(pages: readonly AssemblyPage[]): Promise<Uint8Array> {
  if (pages.length < 1 || pages.length > 40) throw new Error("Add between 1 and 40 pages.");
  const pdf = await PDFDocument.create();
  for (const page of pages) {
    // pdf-lib reads a JPEG from byte 0 of the underlying ArrayBuffer. A Node Buffer view has to be copied.
    const owned = Uint8Array.from(page.bytes);
    const image = page.mediaType === "image/jpeg" ? await pdf.embedJpg(owned) : await pdf.embedPng(owned);
    const placed = placement(image.width, image.height, page.rotation);
    const sheet = pdf.addPage([placed.pageWidth, placed.pageHeight]);
    sheet.drawImage(image, {
      x: placed.x,
      y: placed.y,
      width: image.width,
      height: image.height,
      rotate: degrees(placed.rotate),
    });
  }
  pdf.setProducer("Casevoya");
  return pdf.save({ useObjectStreams: false });
}
