import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

export { PREVIEWABLE } from "@/modules/documents/previewable";

/** Text the standard PDF font can draw: anything outside Latin-1 becomes "?". */
export function latin1(text: string): string {
  return Array.from(text, (char) => (char.charCodeAt(0) <= 0xff && char.charCodeAt(0) >= 0x20 ? char : "?")).join("");
}

/** "Dana Staff · 24 Oct 2026 14:05 UTC · Casevoya preview, not the original" */
export function previewStamp(viewer: string, at: Date): string {
  const when = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  return `${viewer} · ${when} UTC · Casevoya preview, not the original`;
}

/**
 * A preview PDF with the viewer's name burned into every page (DOC-07): a PDF keeps its pages; a
 * JPEG or PNG is placed on a page of its own size. Null when the file can't be read (an encrypted
 * or damaged PDF, another type): the person downloads it instead. The original is never changed.
 */
export async function watermarkedPreview(bytes: Uint8Array, mediaType: string, stamp: string): Promise<Uint8Array | null> {
  let pdf: PDFDocument;
  try {
    if (mediaType === "application/pdf") {
      pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    } else if (mediaType === "image/jpeg" || mediaType === "image/png") {
      pdf = await PDFDocument.create();
      const image = mediaType === "image/jpeg" ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
      // Large photos are scaled to a page no wider or taller than 1600 points.
      const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      const page = pdf.addPage([image.width * scale, image.height * scale]);
      page.drawImage(image, { x: 0, y: 0, width: image.width * scale, height: image.height * scale });
    } else {
      return null;
    }
  } catch {
    return null;
  }
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const text = latin1(stamp);
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const big = Math.max(10, Math.min(width, height) / 28);
    const across = font.widthOfTextAtSize(text, big);
    // Corner to corner, faint, so the page stays readable.
    const angle = Math.atan2(height, width);
    page.drawText(text, {
      x: width / 2 - (Math.cos(angle) * across) / 2,
      y: height / 2 - (Math.sin(angle) * across) / 2,
      size: big,
      font,
      color: rgb(0.55, 0.55, 0.55),
      opacity: 0.28,
      rotate: degrees((angle * 180) / Math.PI),
    });
    page.drawText(text, { x: 12, y: 10, size: 8, font, color: rgb(0.35, 0.35, 0.35), opacity: 0.8 });
  }
  pdf.setTitle("Casevoya preview");
  pdf.setProducer("Casevoya");
  return pdf.save();
}
