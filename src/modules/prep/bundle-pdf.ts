/**
 * PREP-03: one evidence bundle PDF. Cover page, then an index, then the selected PDF and image
 * pages, with a page number on every page. DOCX and HEIC stay in the index and are not copied
 * in: pdf-lib cannot place them on a page. This is the firm's ordered copy, not a government form.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export const BUNDLE_PAGE_WIDTH = 612;
export const BUNDLE_PAGE_HEIGHT = 792;
const MARGIN = 54;
const INDEX_ROWS = 16;

export type BundleSource = {
  fileName: string;
  purpose: string;
  mediaType: string;
  bytes: Uint8Array;
};

export type BundleIndexRow = {
  fileName: string;
  purpose: string;
  included: boolean;
  startPage: number | null;
  endPage: number | null;
  reason: string | null;
};

export type BundlePlan = {
  indexPages: number;
  totalPages: number;
  rows: BundleIndexRow[];
};

type Prepared = {
  fileName: string;
  purpose: string;
  included: boolean;
  pageCount: number;
  reason: string | null;
  bytes: Uint8Array | null;
  mediaType: string;
};

export function bundleMediaIncluded(mediaType: string): boolean {
  const type = mediaType.toLowerCase();
  return type === "application/pdf" || type === "image/jpeg" || type === "image/jpg" || type === "image/png";
}

/** Page numbers once each file's page count is known. Cover is page 1. */
export function planBundle(prepared: Pick<Prepared, "fileName" | "purpose" | "included" | "pageCount" | "reason">[]): BundlePlan {
  const indexPages = Math.max(1, Math.ceil(prepared.length / INDEX_ROWS) || 1);
  let cursor = 1 + indexPages + 1;
  const rows = prepared.map((source) => {
    if (!source.included || source.pageCount < 1) {
      return {
        fileName: source.fileName,
        purpose: source.purpose,
        included: false,
        startPage: null,
        endPage: null,
        reason: source.reason ?? "Not included in the PDF.",
      };
    }
    const startPage = cursor;
    cursor += source.pageCount;
    return {
      fileName: source.fileName,
      purpose: source.purpose,
      included: true,
      startPage,
      endPage: startPage + source.pageCount - 1,
      reason: null,
    };
  });
  const contentPages = prepared.reduce((sum, source) => sum + (source.included ? source.pageCount : 0), 0);
  return { indexPages, totalPages: 1 + indexPages + contentPages, rows };
}

function drawWrapped(page: PDFPage, font: PDFFont, text: string, x: number, y: number, size: number, maxWidth: number): number {
  const words = text.split(/\s+/).filter(Boolean);
  let line = "";
  let cursor = y;
  const next = (value: string) => {
    page.drawText(value, { x, y: cursor, size, font, color: rgb(0.07, 0.07, 0.07) });
    cursor -= size + 4;
  };
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(trial, size) > maxWidth && line) {
      next(line);
      line = word;
    } else {
      line = trial;
    }
  }
  if (line) next(line);
  return cursor;
}

function stampPageNumbers(doc: PDFDocument, font: PDFFont) {
  const pages = doc.getPages();
  const total = pages.length;
  pages.forEach((page, index) => {
    const label = `Page ${index + 1} of ${total}`;
    const width = page.getWidth();
    const textWidth = font.widthOfTextAtSize(label, 9);
    page.drawRectangle({ x: 0, y: 0, width, height: 28, color: rgb(1, 1, 1) });
    page.drawText(label, { x: Math.max(24, (width - textWidth) / 2), y: 12, size: 9, font, color: rgb(0.32, 0.3, 0.28) });
  });
}

async function prepare(source: BundleSource): Promise<Prepared> {
  const media = source.mediaType.toLowerCase();
  if (!bundleMediaIncluded(media)) {
    return {
      fileName: source.fileName,
      purpose: source.purpose,
      included: false,
      pageCount: 0,
      reason: "Kept as its own file. This bundle copies PDF, JPEG and PNG pages only.",
      bytes: null,
      mediaType: media,
    };
  }
  if (media === "application/pdf") {
    try {
      const loaded = await PDFDocument.load(source.bytes, { ignoreEncryption: true, updateMetadata: false });
      const pageCount = loaded.getPageCount();
      if (pageCount < 1) throw new Error("empty");
      return { fileName: source.fileName, purpose: source.purpose, included: true, pageCount, reason: null, bytes: source.bytes, mediaType: media };
    } catch {
      return {
        fileName: source.fileName,
        purpose: source.purpose,
        included: false,
        pageCount: 0,
        reason: "This PDF could not be copied into the bundle. It stays as its own file.",
        bytes: null,
        mediaType: media,
      };
    }
  }
  return { fileName: source.fileName, purpose: source.purpose, included: true, pageCount: 1, reason: null, bytes: source.bytes, mediaType: media };
}

export type BundlePdfInput = {
  firmName: string;
  matterReference: string;
  channelLabel: string;
  generatedAt: string;
  documents: BundleSource[];
  maxBytes: number;
};

export type BundlePdfResult =
  | { pdf: Uint8Array; plan: BundlePlan; byteSize: number }
  | { error: "empty" }
  | { error: "over_limit"; byteSize: number; maxBytes: number; plan: BundlePlan };

/** Cover, index, then documents in order. Refuses an empty selection and a file over the channel cap. */
export async function renderEvidenceBundle(input: BundlePdfInput): Promise<BundlePdfResult> {
  if (input.documents.length === 0) return { error: "empty" };
  const doc = await PDFDocument.create();
  doc.setTitle("Evidence bundle");
  doc.setProducer("Casevoya");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const prepared: Prepared[] = [];
  for (const source of input.documents) prepared.push(await prepare(source));
  const plan = planBundle(prepared);

  const cover = doc.addPage([BUNDLE_PAGE_WIDTH, BUNDLE_PAGE_HEIGHT]);
  cover.drawText("Evidence bundle", { x: MARGIN, y: 700, size: 22, font: bold, color: rgb(0.07, 0.07, 0.07) });
  let y = drawWrapped(cover, font, input.firmName, MARGIN, 660, 14, 500);
  y = drawWrapped(cover, font, `Matter ${input.matterReference || "reference not recorded"}`, MARGIN, y - 8, 12, 500);
  y = drawWrapped(cover, font, `Channel ${input.channelLabel}`, MARGIN, y - 4, 12, 500);
  y = drawWrapped(cover, font, `Prepared ${input.generatedAt}`, MARGIN, y - 4, 12, 500);
  drawWrapped(
    cover,
    font,
    "This is the firm’s ordered copy of the selected files: a cover, an index, then the documents. It is not a government form and it is not a submission to IRCC.",
    MARGIN,
    y - 16,
    11,
    500,
  );

  for (let pageIndex = 0; pageIndex < plan.indexPages; pageIndex += 1) {
    const page = doc.addPage([BUNDLE_PAGE_WIDTH, BUNDLE_PAGE_HEIGHT]);
    page.drawText(plan.indexPages === 1 ? "Document index" : `Document index (${pageIndex + 1} of ${plan.indexPages})`, {
      x: MARGIN,
      y: 730,
      size: 16,
      font: bold,
      color: rgb(0.07, 0.07, 0.07),
    });
    let rowY = 690;
    const slice = plan.rows.slice(pageIndex * INDEX_ROWS, (pageIndex + 1) * INDEX_ROWS);
    for (const row of slice) {
      const where = row.included && row.startPage && row.endPage ? (row.startPage === row.endPage ? `Page ${row.startPage}` : `Pages ${row.startPage}–${row.endPage}`) : "Not in this PDF";
      page.drawText(where, { x: MARGIN, y: rowY, size: 10, font: bold, color: rgb(0.07, 0.07, 0.07) });
      const detail = row.included ? `${row.fileName} — ${row.purpose}` : `${row.fileName} — ${row.reason ?? row.purpose}`;
      rowY = drawWrapped(page, font, detail, MARGIN + 88, rowY, 10, 360) - 8;
    }
  }

  for (const source of prepared) {
    if (!source.included || !source.bytes) continue;
    if (source.mediaType === "application/pdf") {
      const loaded = await PDFDocument.load(source.bytes, { ignoreEncryption: true, updateMetadata: false });
      const copied = await doc.copyPages(loaded, loaded.getPageIndices());
      for (const page of copied) doc.addPage(page);
      continue;
    }
    const image = source.mediaType === "image/png" ? await doc.embedPng(source.bytes) : await doc.embedJpg(source.bytes);
    const page = doc.addPage([BUNDLE_PAGE_WIDTH, BUNDLE_PAGE_HEIGHT]);
    const maxW = BUNDLE_PAGE_WIDTH - MARGIN * 2;
    const maxH = BUNDLE_PAGE_HEIGHT - 80;
    const scale = Math.min(maxW / image.width, maxH / image.height, 1);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, { x: (BUNDLE_PAGE_WIDTH - width) / 2, y: (BUNDLE_PAGE_HEIGHT - height) / 2, width, height });
  }

  stampPageNumbers(doc, font);
  const pdf = await doc.save();
  if (pdf.byteLength > input.maxBytes) return { error: "over_limit", byteSize: pdf.byteLength, maxBytes: input.maxBytes, plan };
  return { pdf, plan, byteSize: pdf.byteLength };
}
