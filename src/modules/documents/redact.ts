import "server-only";
import { deflateSync } from "node:zlib";
import { decode as decodeJpeg } from "jpeg-js";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  StandardFonts,
  decodePDFRawStream,
  type PDFFont,
  type PDFObject,
  type PDFPage,
} from "pdf-lib";
import { PNG } from "pngjs";
import {
  IDENTITY,
  apply,
  boundsOf,
  contains,
  displayedRectToUser,
  intersects,
  invert,
  multiply,
  type Matrix,
  type NormRect,
  type PageBox,
  type UserRect,
} from "@/modules/documents/redact-geometry";

/**
 * DOC-07: a redacted copy whose marked areas no longer contain the original text or image samples.
 *
 * pdf-lib can draw a black rectangle and nothing more: the text operators and the image stream
 * stay in the file, and copying text out of the "black" area still works. MuPDF's WASM build
 * (about 14 MB) would do this with applyRedactions, and it does not fit on top of the OpenNext
 * Worker. The virus-scan container is a separate service and is not required for a copy to be
 * made, so redaction runs here, in the Worker, with the libraries already available (pdf-lib,
 * zlib via nodejs_compat) plus a pure-JS JPEG decoder.
 *
 * Text-showing operators whose glyphs meet a box are replaced with a cursor move and no string.
 * An image that meets a box is decoded and the samples under the box are set to black, then
 * stored again as a new compressed stream; the previous stream bytes are not kept. A black
 * rectangle is also painted so the area reads as redacted. Form data, alternate text, the
 * structure tree, metadata, attachments and scripts are not carried into the copy (scrubDocument).
 * The caller's buffer is not modified.
 */

export type RedactionRegion = NormRect & { page: number };

export class RedactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedactionError";
  }
}

// Decode caps sized for the Worker's memory: a 12 MP phone photo fits, larger images are refused.
const MAX_PIXELS = 13_000_000;
const JPEG_LIMITS = { maxResolutionInMP: 13, maxMemoryUsageInMB: 128 } as const;
const UNSAFE = "This PDF can’t be redacted safely, so no copy was made.";

type Widths = (code: number) => number;

/** `modelled` is false for Type3 fonts and vertical writing, whose glyph positions are not computed here. */
type FontInfo = { widths: Widths; modelled: boolean };

const DEFAULT_FONT: FontInfo = { widths: () => 1000, modelled: true };

type Graphics = {
  ctm: Matrix;
  font: string;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  horizontalScale: number;
  leading: number;
  rise: number;
};

type Token =
  | { kind: "num"; value: number; start: number; end: number }
  | { kind: "name"; value: string; start: number; end: number }
  | { kind: "str"; bytes: Uint8Array; start: number; end: number }
  | { kind: "arr"; items: Token[]; start: number; end: number }
  | { kind: "dict"; start: number; end: number }
  | { kind: "op"; value: string; start: number; end: number };

export async function redactDocument(bytes: Uint8Array, mediaType: string, regions: readonly RedactionRegion[]): Promise<Uint8Array> {
  const areas = cleanRegions(regions);
  if (mediaType === "image/jpeg" || mediaType === "image/png") return redactRaster(bytes.slice(), mediaType, areas);
  if (mediaType === "application/pdf") return redactPdf(bytes.slice(), areas);
  throw new RedactionError("This file type can’t be redacted. Use a PDF, JPEG, or PNG.");
}

function cleanRegions(regions: readonly RedactionRegion[]): RedactionRegion[] {
  if (regions.length < 1 || regions.length > 40) throw new RedactionError("Mark between 1 and 40 areas.");
  return regions.map((region) => {
    if (!Number.isInteger(region.page) || region.page < 0 || region.page > 2000) throw new RedactionError("Mark an area on a page.");
    const x = clamp01(region.x);
    const y = clamp01(region.y);
    const width = Math.min(Math.max(region.width, 0), 1 - x);
    const height = Math.min(Math.max(region.height, 0), 1 - y);
    if (width < 0.004 || height < 0.004) throw new RedactionError("Mark an area on the page.");
    return { page: region.page, x, y, width, height };
  });
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) throw new RedactionError("Mark an area on the page.");
  return Math.min(1, Math.max(0, value));
}

async function redactRaster(bytes: Uint8Array, mediaType: "image/jpeg" | "image/png", regions: readonly RedactionRegion[]): Promise<Uint8Array> {
  if (regions.some((region) => region.page !== 0)) throw new RedactionError("Mark an area on a page.");
  const image = mediaType === "image/jpeg" ? decodeRasterJpeg(bytes) : decodeRasterPng(bytes);
  const box = { x: 0, y: 0, width: image.width, height: image.height };
  const user = regions.map((region) => displayedRectToUser(region, box, 0));
  // The unit square is the image; user space here is pixels, origin at the bottom left.
  const ctm: Matrix = [image.width, 0, 0, image.height, 0, 0];
  blacken(image.rgba, image.width, image.height, 4, ctm, user);
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.rgba);
  return PNG.sync.write(png);
}

function decodeRasterJpeg(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  try {
    const decoded = decodeJpeg(bytes, { useTArray: true, formatAsRGBA: true, ...JPEG_LIMITS });
    return { width: decoded.width, height: decoded.height, rgba: decoded.data };
  } catch {
    throw new RedactionError("This image can’t be redacted.");
  }
}

function decodeRasterPng(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  // IHDR width and height (big-endian) at bytes 16..23, checked before the full decode.
  if (bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(16) * view.getUint32(20) > MAX_PIXELS) throw new RedactionError("This image is too large to redact, so no copy was made.");
  }
  try {
    const png = PNG.sync.read(Buffer.from(bytes));
    return { width: png.width, height: png.height, rgba: png.data };
  } catch {
    throw new RedactionError("This image can’t be redacted.");
  }
}

async function redactPdf(bytes: Uint8Array, regions: readonly RedactionRegion[]): Promise<Uint8Array> {
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new RedactionError("This PDF is encrypted or damaged, so it can’t be redacted.");
  }
  const pages = pdf.getPages();
  if (regions.some((region) => region.page >= pages.length)) throw new RedactionError("Mark an area on a page that exists.");
  const standard = await standardWidths();
  for (let index = 0; index < pages.length; index += 1) {
    const onPage = regions.filter((region) => region.page === index);
    if (onPage.length === 0) continue;
    const page = pages[index];
    if (!page) continue;
    const view = visibleBox(page);
    const user = onPage.map((region) => displayedRectToUser(region, view, page.getRotation().angle));
    rewritePage(pdf, page, user, standard);
    blankAnnotations(pdf, page, user);
  }
  scrubDocument(pdf);
  return pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
}

/**
 * The area a viewer shows, which is where the marks were drawn: the CropBox clipped to the
 * MediaBox, or the MediaBox when there is no CropBox or the two don't overlap (as pdf.js does).
 */
function visibleBox(page: PDFPage): PageBox {
  const media = normalBox(page.getMediaBox());
  const crop = normalBox(page.getCropBox());
  const left = Math.max(media.x, crop.x);
  const bottom = Math.max(media.y, crop.y);
  const right = Math.min(media.x + media.width, crop.x + crop.width);
  const top = Math.min(media.y + media.height, crop.y + crop.height);
  if (right - left > 0 && top - bottom > 0) return { x: left, y: bottom, width: right - left, height: top - bottom };
  return media;
}

function normalBox(box: PageBox): PageBox {
  const x = Math.min(box.x, box.x + box.width);
  const y = Math.min(box.y, box.y + box.height);
  return { x, y, width: Math.abs(box.width), height: Math.abs(box.height) };
}

const CATALOG_DROP = ["AcroForm", "StructTreeRoot", "MarkInfo", "Metadata", "OpenAction", "AA", "Perms", "AF", "Collection", "PieceInfo"];
const PAGE_DROP = ["Metadata", "PieceInfo", "Thumb", "AA", "AF"];
const WIDGET_DROP = ["V", "DV", "RV", "Parent", "T", "TU", "TM", "Opt", "I", "Lock", "SV", "Ff", "FT", "MaxLen", "DA", "DS", "Q", "AA"];
const PROPERTY_DROP = ["ActualText", "Alt", "E"];

/**
 * A redacted copy carries the page content only: form data (AcroForm, XFA, field values), the
 * structure tree, document and object metadata, page thumbnails, embedded files and scripts are
 * removed, alternate text is stripped from marked-content properties, and objects no longer
 * reachable from the catalog are not written.
 */
function scrubDocument(pdf: PDFDocument): void {
  const catalog = pdf.catalog;
  for (const key of CATALOG_DROP) catalog.delete(PDFName.of(key));
  const names = dictAt(catalog, "Names");
  names?.delete(PDFName.of("EmbeddedFiles"));
  names?.delete(PDFName.of("JavaScript"));
  pdf.context.trailerInfo.Info = undefined;
  for (const page of pdf.getPages()) {
    for (const key of PAGE_DROP) page.node.delete(PDFName.of(key));
    scrubAnnotations(page.node);
  }
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFDict ? object : object instanceof PDFStream ? object.dict : undefined;
    if (!dict) continue;
    dict.delete(PDFName.of("Metadata"));
    dict.delete(PDFName.of("PieceInfo"));
    const properties = dictAt(dictAt(dict, "Resources"), "Properties");
    if (!properties) continue;
    for (const [key] of properties.entries()) {
      const entry = properties.lookup(key);
      if (entry instanceof PDFDict) for (const drop of PROPERTY_DROP) entry.delete(PDFName.of(drop));
    }
  }
  collectGarbage(pdf);
}

function scrubAnnotations(node: PDFDict): void {
  const annots = node.lookup(PDFName.of("Annots"));
  if (!(annots instanceof PDFArray)) return;
  for (let index = 0; index < annots.size(); index += 1) {
    const annot = annots.lookup(index);
    if (!(annot instanceof PDFDict)) continue;
    annot.delete(PDFName.of("AA"));
    const action = dictAt(annot, "A");
    if (action && action.lookup(PDFName.of("S")) === PDFName.of("JavaScript")) annot.delete(PDFName.of("A"));
    const subtype = annot.lookup(PDFName.of("Subtype"));
    // Without the AcroForm a widget is drawn from its appearance only; its value and field go.
    if (subtype === PDFName.of("Widget")) for (const key of WIDGET_DROP) annot.delete(PDFName.of(key));
    if (subtype === PDFName.of("FileAttachment")) annot.delete(PDFName.of("FS"));
  }
}

function dictAt(dict: PDFDict | undefined, key: string): PDFDict | undefined {
  const value = dict?.lookup(PDFName.of(key));
  return value instanceof PDFDict ? value : undefined;
}

/** Deletes every indirect object not reachable from the catalog (old revisions, removed parts). */
function collectGarbage(pdf: PDFDocument): void {
  const context = pdf.context;
  const seen = new Set<string>();
  const stack: PDFObject[] = [];
  if (context.trailerInfo.Root) stack.push(context.trailerInfo.Root);
  while (stack.length > 0) {
    const object = stack.pop();
    if (object instanceof PDFRef) {
      if (seen.has(object.tag)) continue;
      seen.add(object.tag);
      const target = context.lookup(object);
      if (target) stack.push(target);
    } else if (object instanceof PDFDict) {
      for (const [, value] of object.entries()) stack.push(value);
    } else if (object instanceof PDFArray) {
      for (let index = 0; index < object.size(); index += 1) stack.push(object.get(index));
    } else if (object instanceof PDFStream) {
      stack.push(object.dict);
    }
  }
  const unreachable = context.enumerateIndirectObjects().filter(([ref]) => !seen.has(ref.tag)).map(([ref]) => ref);
  for (const ref of unreachable) context.delete(ref);
}

async function standardWidths(): Promise<Map<string, Map<number, number>>> {
  const pdf = await PDFDocument.create();
  const faces: [string, StandardFonts][] = [
    ["Helvetica", StandardFonts.Helvetica],
    ["Helvetica-Bold", StandardFonts.HelveticaBold],
    ["Helvetica-Oblique", StandardFonts.HelveticaOblique],
    ["Helvetica-BoldOblique", StandardFonts.HelveticaBoldOblique],
    ["Times-Roman", StandardFonts.TimesRoman],
    ["Times-Bold", StandardFonts.TimesRomanBold],
    ["Times-Italic", StandardFonts.TimesRomanItalic],
    ["Times-BoldItalic", StandardFonts.TimesRomanBoldItalic],
    ["Courier", StandardFonts.Courier],
    ["Courier-Bold", StandardFonts.CourierBold],
    ["Courier-Oblique", StandardFonts.CourierOblique],
    ["Courier-BoldOblique", StandardFonts.CourierBoldOblique],
  ];
  const out = new Map<string, Map<number, number>>();
  for (const [name, face] of faces) {
    const font = await pdf.embedFont(face);
    out.set(name, asciiWidths(font));
  }
  return out;
}

function asciiWidths(font: PDFFont): Map<number, number> {
  const widths = new Map<number, number>();
  for (let code = 32; code < 127; code += 1) widths.set(code, Math.round(font.widthOfTextAtSize(String.fromCharCode(code), 1000)));
  return widths;
}

function rewritePage(pdf: PDFDocument, page: PDFPage, rects: readonly UserRect[], standard: Map<string, Map<number, number>>): void {
  const refs = contentRefs(page.node);
  if (refs.length === 0) return;
  // Resources may be inherited from the Pages tree.
  const resources = page.node.Resources();
  const fonts = fontMap(resources, standard);
  const parts: Uint8Array[] = [];
  for (const ref of refs) parts.push(decodeContent(rawStream(pdf, ref)));
  const joined = concatBytes(parts);
  if (joined.length > 20_000_000) throw new RedactionError(UNSAFE);
  const graphics = freshGraphics();
  const rewritten = rewriteStream(joined, graphics, rects, (name, ctm) => {
    paintImage(pdf, resources, name, ctm, rects, standard);
  }, fonts);
  const black = blackPath(rects, graphics.ctm);
  const first = refs[0];
  if (!first) return;
  const firstStream = rawStream(pdf, first);
  firstStream.dict.delete(PDFName.of("Filter"));
  firstStream.dict.delete(PDFName.of("DecodeParms"));
  pdf.context.assign(first, PDFRawStream.of(firstStream.dict, concatBytes([rewritten, black])));
  for (const ref of refs.slice(1)) {
    const stream = rawStream(pdf, ref);
    stream.dict.delete(PDFName.of("Filter"));
    stream.dict.delete(PDFName.of("DecodeParms"));
    pdf.context.assign(ref, PDFRawStream.of(stream.dict, new Uint8Array()));
  }
}

function rawStream(pdf: PDFDocument, ref: PDFRef): PDFRawStream {
  const object = pdf.context.lookup(ref);
  if (!(object instanceof PDFRawStream)) throw new RedactionError("This PDF can’t be redacted safely, so no copy was made.");
  return object;
}

function contentRefs(node: PDFDict): PDFRef[] {
  const raw = node.get(PDFName.of("Contents"));
  if (raw instanceof PDFRef) return [raw];
  if (raw instanceof PDFArray) {
    const refs: PDFRef[] = [];
    for (let index = 0; index < raw.size(); index += 1) {
      const item = raw.get(index);
      if (item instanceof PDFRef) refs.push(item);
    }
    return refs;
  }
  return [];
}

function decodeContent(stream: PDFRawStream): Uint8Array {
  try {
    return decodePDFRawStream(stream).decode();
  } catch {
    throw new RedactionError("This PDF can’t be redacted safely, so no copy was made.");
  }
}

function fontMap(resources: PDFDict | undefined, standard: Map<string, Map<number, number>>): Map<string, FontInfo> {
  const map = new Map<string, FontInfo>();
  const fonts = resources?.lookupMaybe(PDFName.of("Font"), PDFDict);
  if (!fonts) return map;
  for (const [name] of fonts.entries()) {
    const font = fonts.lookupMaybe(name, PDFDict);
    if (font) map.set(name.decodeText(), { widths: widthsFor(font, standard), modelled: fontIsModelled(font) });
  }
  return map;
}

/** Type3 glyphs are arbitrary drawings and vertical writing advances down the page; neither is modelled. */
function fontIsModelled(font: PDFDict): boolean {
  const subtype = font.lookup(PDFName.of("Subtype"));
  if (subtype === PDFName.of("Type3")) return false;
  if (subtype !== PDFName.of("Type0")) return true;
  return !verticalEncoding(font.lookup(PDFName.of("Encoding")), 0);
}

function verticalEncoding(encoding: PDFObject | undefined, depth: number): boolean {
  if (encoding instanceof PDFName) return verticalCMapName(encoding.decodeText());
  if (!(encoding instanceof PDFRawStream) || depth > 4) return true;
  const mode = encoding.dict.lookup(PDFName.of("WMode"));
  if (mode instanceof PDFNumber) return mode.asNumber() !== 0;
  const parent = encoding.dict.lookup(PDFName.of("UseCMap"));
  if (parent !== undefined && verticalEncoding(parent, depth + 1)) return true;
  try {
    const text = Buffer.from(decodePDFRawStream(encoding).decode()).toString("latin1");
    return /\/WMode\s+[^0\s]/.test(text);
  } catch {
    return true;
  }
}

function verticalCMapName(name: string): boolean {
  return name === "V" || name.endsWith("-V");
}

function widthsFor(font: PDFDict, standard: Map<string, Map<number, number>>): Widths {
  const base = font.lookupMaybe(PDFName.of("BaseFont"), PDFName);
  const bare = (base?.decodeText() ?? "").split("+").pop() ?? "";
  const known = standard.get(bare);
  if (known) return (code) => known.get(code) ?? 1000;
  const first = font.lookupMaybe(PDFName.of("FirstChar"), PDFNumber);
  const widths = font.lookupMaybe(PDFName.of("Widths"), PDFArray);
  if (first && widths) {
    const start = first.asNumber();
    return (code) => {
      const item = widths.lookupMaybe(code - start, PDFNumber);
      return item ? item.asNumber() : 1000;
    };
  }
  const descendants = font.lookupMaybe(PDFName.of("DescendantFonts"), PDFArray);
  const child = descendants?.lookupMaybe(0, PDFDict);
  if (child) return widthsFor(child, standard);
  return () => 1000;
}

function freshGraphics(): Graphics {
  return { ctm: IDENTITY, font: "", fontSize: 12, charSpacing: 0, wordSpacing: 0, horizontalScale: 100, leading: 0, rise: 0 };
}

function rewriteStream(bytes: Uint8Array, graphics: Graphics, rects: readonly UserRect[], onImage: (name: string, ctm: Matrix) => void, fonts: Map<string, FontInfo>): Uint8Array {
  const tokens = tokenize(bytes);
  const kept: Uint8Array[] = [];
  const operands: Token[] = [];
  let start = -1;
  const text = { tm: IDENTITY, tlm: IDENTITY };
  let inText = false;
  const stack: Graphics[] = [];
  const currentFont = () => fonts.get(graphics.font) ?? DEFAULT_FONT;

  const flush = (token: Token) => {
    const from = start < 0 ? token.start : start;
    const operator = token.kind === "op" ? token.value : "";
    if (operator === "BI") throw new RedactionError(UNSAFE);
    // ' and " move to the next line (and " sets word and character spacing) before showing.
    if (operator === "'" || operator === '"') startLine(operator, operands, graphics, text);
    const font = currentFont();
    if (inText && showsText(operator) && !font.modelled && textChunks(operands, operator).length > 0) throw new RedactionError(UNSAFE);
    const glyphWidths = font.widths;
    const drop = inText && showsText(operator) && textHits(operands, operator, text.tm, graphics, glyphWidths, rects);
    const marked = markedContentWithoutProperties(bytes, operands, operator);
    if (marked) kept.push(marked);
    else if (!drop) kept.push(bytes.subarray(from, token.end));
    else kept.push(cursorMove(operands, operator, graphics, glyphWidths));
    applyOperator(operator, operands, graphics, text, stack, onImage, glyphWidths);
    if (operator === "BT") inText = true;
    if (operator === "ET") inText = false;
    operands.length = 0;
    start = -1;
  };

  for (const token of tokens) {
    if (token.kind === "op") flush(token);
    else {
      if (start < 0) start = token.start;
      operands.push(token);
    }
  }
  return concatBytes(kept);
}

/**
 * `/Tag <<...>> BDC` becomes `/Tag BMC` (and DP becomes MP): an inline property list can carry
 * ActualText, Alt or E for the text it wraps. A named list (`/Tag /P0 BDC`, used for optional
 * content) is kept; its resource entry is cleaned in scrubDocument.
 */
function markedContentWithoutProperties(bytes: Uint8Array, operands: readonly Token[], operator: string): Uint8Array | null {
  if (operator !== "BDC" && operator !== "DP") return null;
  const [tag, properties] = operands;
  if (operands.length !== 2 || tag?.kind !== "name" || properties?.kind !== "dict") return null;
  return concatBytes([latin1("\n"), bytes.subarray(tag.start, tag.end), latin1(operator === "BDC" ? " BMC\n" : " MP\n")]);
}

function showsText(operator: string): boolean {
  return operator === "Tj" || operator === "TJ" || operator === "'" || operator === '"';
}

function textHits(operands: readonly Token[], operator: string, tm: Matrix, graphics: Graphics, widths: Widths, rects: readonly UserRect[]): boolean {
  const chunks = textChunks(operands, operator);
  if (chunks.length === 0) return false;
  let cursor = tm;
  for (const chunk of chunks) {
    if (chunk.kind === "gap") {
      cursor = multiply(cursor, [1, 0, 0, 1, gapAdvance(chunk.value, graphics), 0]);
      continue;
    }
    const advance = stringAdvance(chunk.bytes, graphics, widths);
    const box = glyphBox(cursor, advance, graphics);
    if (rects.some((rect) => intersects(rect, box))) return true;
    cursor = multiply(cursor, [1, 0, 0, 1, advance, 0]);
  }
  return false;
}

function glyphBox(tm: Matrix, advance: number, graphics: Graphics): UserRect {
  // Text rise (Ts) shifts glyphs up or down from the baseline in text space.
  const rise = 0.85 * graphics.fontSize + graphics.rise;
  const sink = -0.25 * graphics.fontSize + graphics.rise;
  const point = (x: number, y: number): [number, number] => {
    const [textX, textY] = apply(tm, x, y);
    return apply(graphics.ctm, textX, textY);
  };
  const corners = [point(0, sink), point(advance, sink), point(advance, rise), point(0, rise)];
  const box = boundsOf(corners);
  return { x: box.x - 0.5, y: box.y - 0.5, width: box.width + 1, height: box.height + 1 };
}

function stringAdvance(bytes: Uint8Array, graphics: Graphics, widths: Widths): number {
  const scale = graphics.horizontalScale / 100;
  let total = 0;
  for (const code of bytes) {
    let tx = (widths(code) / 1000) * graphics.fontSize + graphics.charSpacing;
    if (code === 32) tx += graphics.wordSpacing;
    total += tx * scale;
  }
  return total;
}

function gapAdvance(thousandths: number, graphics: Graphics): number {
  return (-thousandths / 1000) * graphics.fontSize * (graphics.horizontalScale / 100);
}

function textChunks(operands: readonly Token[], operator: string): ({ kind: "text"; bytes: Uint8Array } | { kind: "gap"; value: number })[] {
  if (operator === "Tj" || operator === "'") {
    const token = operands[0];
    return token?.kind === "str" ? [{ kind: "text", bytes: token.bytes }] : [];
  }
  if (operator === '"') {
    const token = operands[2];
    return token?.kind === "str" ? [{ kind: "text", bytes: token.bytes }] : [];
  }
  if (operator === "TJ") {
    const token = operands[0];
    if (token?.kind !== "arr") return [];
    const chunks: ({ kind: "text"; bytes: Uint8Array } | { kind: "gap"; value: number })[] = [];
    for (const item of token.items) {
      if (item.kind === "str") chunks.push({ kind: "text", bytes: item.bytes });
      if (item.kind === "num") chunks.push({ kind: "gap", value: item.value });
    }
    return chunks;
  }
  return [];
}

/** A cursor move with the same advance as the removed text, and none of its bytes. */
function cursorMove(operands: readonly Token[], operator: string, graphics: Graphics, widths: Widths): Uint8Array {
  const chunks = textChunks(operands, operator);
  let advance = 0;
  for (const chunk of chunks) advance += chunk.kind === "gap" ? gapAdvance(chunk.value, graphics) : stringAdvance(chunk.bytes, graphics, widths);
  const parts: string[] = [];
  if (operator === "'" || operator === '"') parts.push("T*");
  if (operator === '"') {
    const word = operands[0];
    const character = operands[1];
    if (word?.kind === "num") parts.push(`${trim(word.value)} Tw`);
    if (character?.kind === "num") parts.push(`${trim(character.value)} Tc`);
  }
  if (graphics.fontSize > 0) {
    const adjust = (-advance * 1000) / (graphics.fontSize * (graphics.horizontalScale / 100));
    parts.push(`[${trim(adjust)}] TJ`);
  }
  return latin1(`\n${parts.join("\n")}\n`);
}

function startLine(operator: string, operands: readonly Token[], graphics: Graphics, text: { tm: Matrix; tlm: Matrix }): void {
  if (operator === '"') {
    const word = operands[0];
    const character = operands[1];
    if (word?.kind === "num") graphics.wordSpacing = word.value;
    if (character?.kind === "num") graphics.charSpacing = character.value;
  }
  text.tlm = multiply(text.tlm, [1, 0, 0, 1, 0, -graphics.leading]);
  text.tm = text.tlm;
}

function trim(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}

function applyOperator(
  operator: string,
  operands: readonly Token[],
  graphics: Graphics,
  text: { tm: Matrix; tlm: Matrix },
  stack: Graphics[],
  onImage: (name: string, ctm: Matrix) => void,
  widths: Widths,
): void {
  const numbers = operands.filter((token): token is Extract<Token, { kind: "num" }> => token.kind === "num").map((token) => token.value);
  switch (operator) {
    case "q":
      stack.push({ ...graphics, ctm: graphics.ctm });
      return;
    case "Q": {
      const saved = stack.pop();
      if (saved) Object.assign(graphics, saved);
      return;
    }
    case "cm":
      if (numbers.length >= 6) graphics.ctm = multiply(graphics.ctm, [numbers[0] ?? 1, numbers[1] ?? 0, numbers[2] ?? 0, numbers[3] ?? 1, numbers[4] ?? 0, numbers[5] ?? 0]);
      return;
    case "BT":
      text.tm = IDENTITY;
      text.tlm = IDENTITY;
      return;
    case "ET":
      return;
    case "Tm":
      if (numbers.length >= 6) {
        text.tm = [numbers[0] ?? 1, numbers[1] ?? 0, numbers[2] ?? 0, numbers[3] ?? 1, numbers[4] ?? 0, numbers[5] ?? 0];
        text.tlm = text.tm;
      }
      return;
    case "Td":
    case "TD": {
      const tx = numbers[0] ?? 0;
      const ty = numbers[1] ?? 0;
      if (operator === "TD") graphics.leading = -ty;
      text.tlm = multiply(text.tlm, [1, 0, 0, 1, tx, ty]);
      text.tm = text.tlm;
      return;
    }
    case "T*":
      text.tlm = multiply(text.tlm, [1, 0, 0, 1, 0, -graphics.leading]);
      text.tm = text.tlm;
      return;
    case "Tf": {
      const name = operands.find((token) => token.kind === "name");
      graphics.font = name && name.kind === "name" ? name.value : graphics.font;
      graphics.fontSize = numbers[0] ?? graphics.fontSize;
      return;
    }
    case "Tc":
      graphics.charSpacing = numbers[0] ?? 0;
      return;
    case "Tw":
      graphics.wordSpacing = numbers[0] ?? 0;
      return;
    case "Tz":
      graphics.horizontalScale = numbers[0] ?? 100;
      return;
    case "TL":
      graphics.leading = numbers[0] ?? 0;
      return;
    case "Ts":
      graphics.rise = numbers[0] ?? 0;
      return;
    case "Tj":
    case "TJ":
    case "'":
    case '"': {
      // The line move for ' and " was applied before the hit test (startLine).
      const chunks = textChunks(operands, operator);
      for (const chunk of chunks) {
        const advance = chunk.kind === "gap" ? gapAdvance(chunk.value, graphics) : stringAdvance(chunk.bytes, graphics, widths);
        text.tm = multiply(text.tm, [1, 0, 0, 1, advance, 0]);
      }
      return;
    }
    case "Do": {
      const name = operands.find((token) => token.kind === "name");
      if (name && name.kind === "name") onImage(name.value, graphics.ctm);
      return;
    }
    default:
      return;
  }
}

function paintImage(
  pdf: PDFDocument,
  resources: PDFDict | undefined,
  name: string,
  ctm: Matrix,
  rects: readonly UserRect[],
  standard: Map<string, Map<number, number>>,
): void {
  const entry = resources?.lookup(PDFName.of("XObject"));
  const xobjects = entry instanceof PDFDict ? entry : undefined;
  const object = xobjects?.lookup(PDFName.of(name));
  const raw = xobjects?.get(PDFName.of(name));
  // Where an unresolved XObject would paint is unknown, so it can't be shown to be outside the marks.
  if (!(object instanceof PDFRawStream) || !(raw instanceof PDFRef)) throw new RedactionError(UNSAFE);
  const subtype = object.dict.lookupMaybe(PDFName.of("Subtype"), PDFName);
  if (subtype === PDFName.of("Form")) {
    rewriteForm(pdf, object, raw, ctm, rects, resources, standard);
    return;
  }
  if (subtype !== PDFName.of("Image")) return;
  const width = object.dict.lookupMaybe(PDFName.of("Width"), PDFNumber)?.asNumber() ?? 0;
  const height = object.dict.lookupMaybe(PDFName.of("Height"), PDFNumber)?.asNumber() ?? 0;
  if (width < 1 || height < 1) return;
  const quad = boundsOf([apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 0, 1), apply(ctm, 1, 1)]);
  if (!rects.some((rect) => intersects(rect, quad))) return;
  if (width * height > MAX_PIXELS) throw new RedactionError("This image is too large to redact, so no copy was made.");
  zeroMask(pdf, object.dict);
  const edited = editImageSamples(object, width, height, ctm, rects);
  putSamples(pdf, raw, object, edited.samples, width, height, edited.colors);
}

function rewriteForm(
  pdf: PDFDocument,
  stream: PDFRawStream,
  ref: PDFRef,
  ctm: Matrix,
  rects: readonly UserRect[],
  parentResources: PDFDict | undefined,
  standard: Map<string, Map<number, number>>,
): void {
  const matrix = stream.dict.lookupMaybe(PDFName.of("Matrix"), PDFArray);
  const formMatrix = matrix ? readMatrix(matrix) : IDENTITY;
  const graphics = freshGraphics();
  graphics.ctm = multiply(ctm, formMatrix);
  // A form is clipped to its BBox; one placed wholly outside the marks shows nothing in them.
  const bbox = formBBox(stream.dict);
  if (bbox) {
    const placed = boundsOf([
      apply(graphics.ctm, bbox[0], bbox[1]),
      apply(graphics.ctm, bbox[2], bbox[1]),
      apply(graphics.ctm, bbox[0], bbox[3]),
      apply(graphics.ctm, bbox[2], bbox[3]),
    ]);
    if (!rects.some((rect) => intersects(rect, placed))) return;
  }
  // A form without its own Resources uses those of the content that paints it.
  const own = stream.dict.lookup(PDFName.of("Resources"));
  const resources = own instanceof PDFDict ? own : parentResources;
  const fonts = fontMap(resources, standard);
  let decoded: Uint8Array;
  try {
    decoded = decodeContent(stream);
  } catch {
    throw new RedactionError(UNSAFE);
  }
  const rewritten = rewriteStream(decoded, graphics, rects, (name, at) => paintImage(pdf, resources, name, at, rects, standard), fonts);
  stream.dict.delete(PDFName.of("Filter"));
  stream.dict.delete(PDFName.of("DecodeParms"));
  pdf.context.assign(ref, PDFRawStream.of(stream.dict, concatBytes([rewritten, blackPath(rects, graphics.ctm)])));
}

function formBBox(dict: PDFDict): [number, number, number, number] | null {
  const array = dict.lookup(PDFName.of("BBox"));
  if (!(array instanceof PDFArray) || array.size() !== 4) return null;
  const numbers: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const item = array.lookup(index);
    if (!(item instanceof PDFNumber) || !Number.isFinite(item.asNumber())) return null;
    numbers.push(item.asNumber());
  }
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = numbers;
  return [x1, y1, x2, y2];
}

function readMatrix(array: PDFArray): Matrix {
  const numbers: number[] = [];
  for (let index = 0; index < array.size() && index < 6; index += 1) {
    const item = array.lookupMaybe(index, PDFNumber);
    numbers.push(item ? item.asNumber() : 0);
  }
  return [numbers[0] ?? 1, numbers[1] ?? 0, numbers[2] ?? 0, numbers[3] ?? 1, numbers[4] ?? 0, numbers[5] ?? 0];
}

function editImageSamples(stream: PDFRawStream, width: number, height: number, ctm: Matrix, rects: readonly UserRect[]): { samples: Uint8Array; colors: 1 | 3 } {
  const decoded = tryDecodeImage(stream, width, height);
  if (!decoded) {
    const samples = new Uint8Array(width * height * 3);
    return { samples, colors: 3 };
  }
  blacken(decoded.samples, width, height, decoded.colors, imageMatrix(ctm), rects);
  return decoded;
}

/** Image unit square (bottom-left origin) through the current transform. Pixel row 0 is the top. */
function imageMatrix(ctm: Matrix): Matrix {
  return ctm;
}

function tryDecodeImage(stream: PDFRawStream, width: number, height: number): { samples: Uint8Array; colors: 1 | 3 } | null {
  const filter = stream.dict.lookupMaybe(PDFName.of("Filter"), PDFName);
  const colors = colorCount(stream.dict);
  if (filter === PDFName.of("DCTDecode") && colors === 3) {
    try {
      const jpeg = decodeJpeg(stream.contents, { useTArray: true, formatAsRGBA: true, ...JPEG_LIMITS });
      if (jpeg.width !== width || jpeg.height !== height) return null;
      return { samples: rgbaToRgb(jpeg.data), colors: 3 };
    } catch {
      return null;
    }
  }
  if (filter !== PDFName.of("FlateDecode") && filter !== undefined) return null;
  if (colors !== 1 && colors !== 3) return null;
  let inflated: Uint8Array;
  try {
    inflated = decodePDFRawStream(stream).decode();
  } catch {
    return null;
  }
  const bits = stream.dict.lookupMaybe(PDFName.of("BitsPerComponent"), PDFNumber)?.asNumber() ?? 8;
  if (bits !== 8) return null;
  const predictor = predictorOf(stream.dict);
  if (predictor <= 1) {
    if (inflated.length < width * height * colors) return null;
    return { samples: inflated.subarray(0, width * height * colors), colors };
  }
  try {
    return { samples: unfilterPng(inflated, width, height, colors), colors };
  } catch {
    return null;
  }
}

function colorCount(dict: PDFDict): number {
  const space = dict.lookupMaybe(PDFName.of("ColorSpace"), PDFName);
  if (space === PDFName.of("DeviceGray")) return 1;
  if (space === PDFName.of("DeviceRGB")) return 3;
  const parms = dict.lookupMaybe(PDFName.of("DecodeParms"), PDFDict);
  const colors = parms?.lookupMaybe(PDFName.of("Colors"), PDFNumber)?.asNumber();
  return colors === 1 || colors === 3 ? colors : 3;
}

function predictorOf(dict: PDFDict): number {
  const parms = dict.lookupMaybe(PDFName.of("DecodeParms"), PDFDict);
  return parms?.lookupMaybe(PDFName.of("Predictor"), PDFNumber)?.asNumber() ?? 1;
}

function unfilterPng(data: Uint8Array, width: number, height: number, colors: number): Uint8Array {
  const rowBytes = width * colors;
  const stride = rowBytes + 1;
  if (data.length < height * stride) throw new Error("short");
  const out = new Uint8Array(height * rowBytes);
  let previous = new Uint8Array(rowBytes);
  for (let row = 0; row < height; row += 1) {
    const filter = data[row * stride] ?? 0;
    const source = data.subarray(row * stride + 1, row * stride + 1 + rowBytes);
    const dest = out.subarray(row * rowBytes, (row + 1) * rowBytes);
    for (let index = 0; index < rowBytes; index += 1) {
      const left = index >= colors ? (dest[index - colors] ?? 0) : 0;
      const up = previous[index] ?? 0;
      const upperLeft = index >= colors ? (previous[index - colors] ?? 0) : 0;
      const raw = source[index] ?? 0;
      dest[index] = (raw + predictorAdd(filter, left, up, upperLeft)) & 255;
    }
    previous = dest.slice();
  }
  return out;
}

function predictorAdd(filter: number, left: number, up: number, upperLeft: number): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return Math.floor((left + up) / 2);
    case 4:
      return paeth(left, up, upperLeft);
    default:
      throw new Error("filter");
  }
}

function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpperLeft = Math.abs(estimate - upperLeft);
  if (toLeft <= toUp && toLeft <= toUpperLeft) return left;
  if (toUp <= toUpperLeft) return up;
  return upperLeft;
}

function rgbaToRgb(rgba: Uint8Array): Uint8Array {
  const rgb = new Uint8Array((rgba.length / 4) * 3);
  for (let index = 0, at = 0; index < rgba.length; index += 4, at += 3) {
    rgb[at] = rgba[index] ?? 0;
    rgb[at + 1] = rgba[index + 1] ?? 0;
    rgb[at + 2] = rgba[index + 2] ?? 0;
  }
  return rgb;
}

function blacken(samples: Uint8Array, width: number, height: number, channels: number, ctm: Matrix, rects: readonly UserRect[]): void {
  const inverse = invert(ctm);
  if (!inverse) {
    samples.fill(0);
    return;
  }
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (const rect of rects) {
    for (const [userX, userY] of [
      [rect.x, rect.y],
      [rect.x + rect.width, rect.y],
      [rect.x, rect.y + rect.height],
      [rect.x + rect.width, rect.y + rect.height],
    ] as const) {
      const [unitX, unitY] = apply(inverse, userX, userY);
      const pixelX = unitX * width;
      const pixelY = (1 - unitY) * height;
      minX = Math.min(minX, pixelX);
      maxX = Math.max(maxX, pixelX);
      minY = Math.min(minY, pixelY);
      maxY = Math.max(maxY, pixelY);
    }
  }
  const x0 = Math.max(0, Math.floor(minX) - 1);
  const y0 = Math.max(0, Math.floor(minY) - 1);
  const x1 = Math.min(width, Math.ceil(maxX) + 1);
  const y1 = Math.min(height, Math.ceil(maxY) + 1);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const [userX, userY] = apply(ctm, (x + 0.5) / width, 1 - (y + 0.5) / height);
      if (!rects.some((rect) => contains(rect, userX, userY))) continue;
      const at = (y * width + x) * channels;
      for (let channel = 0; channel < channels; channel += 1) samples[at + channel] = 0;
    }
  }
}

function putSamples(pdf: PDFDocument, ref: PDFRef, stream: PDFRawStream, samples: Uint8Array, width: number, height: number, colors: 1 | 3): void {
  const dict = stream.dict;
  dict.set(PDFName.of("Filter"), PDFName.of("FlateDecode"));
  dict.set(PDFName.of("Width"), PDFNumber.of(width));
  dict.set(PDFName.of("Height"), PDFNumber.of(height));
  dict.set(PDFName.of("BitsPerComponent"), PDFNumber.of(8));
  dict.set(PDFName.of("ColorSpace"), colors === 1 ? PDFName.of("DeviceGray") : PDFName.of("DeviceRGB"));
  dict.delete(PDFName.of("DecodeParms"));
  dict.delete(PDFName.of("Decode"));
  dict.delete(PDFName.of("SMask"));
  dict.delete(PDFName.of("Mask"));
  pdf.context.assign(ref, PDFRawStream.of(dict, deflateSync(samples)));
}

function zeroMask(pdf: PDFDocument, dict: PDFDict): void {
  const mask = dict.get(PDFName.of("SMask"));
  if (!(mask instanceof PDFRef)) return;
  const stream = pdf.context.lookup(mask);
  if (!(stream instanceof PDFRawStream)) return;
  const width = stream.dict.lookupMaybe(PDFName.of("Width"), PDFNumber)?.asNumber() ?? 1;
  const height = stream.dict.lookupMaybe(PDFName.of("Height"), PDFNumber)?.asNumber() ?? 1;
  if (width * height > MAX_PIXELS) return;
  putSamples(pdf, mask, stream, new Uint8Array(width * height), width, height, 1);
}

function blankAnnotations(pdf: PDFDocument, page: PDFPage, rects: readonly UserRect[]): void {
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!annots) return;
  for (let index = 0; index < annots.size(); index += 1) {
    const annot = annots.lookupMaybe(index, PDFDict);
    const rect = annot?.lookupMaybe(PDFName.of("Rect"), PDFArray);
    if (!annot || !rect) continue;
    let box: UserRect;
    try {
      box = rect.asRectangle();
    } catch {
      continue;
    }
    if (!rects.some((region) => intersects(region, box))) continue;
    annot.set(PDFName.of("Contents"), PDFString.of(""));
    annot.delete(PDFName.of("RC"));
    // Every appearance state (normal, rollover, down, on/off) is replaced by one black box; the
    // old streams are no longer referenced and are not written.
    const width = Math.max(Math.abs(box.width), 1);
    const height = Math.max(Math.abs(box.height), 1);
    const blank = pdf.context.register(
      pdf.context.stream(`0 0 0 rg 0 0 ${trim(width)} ${trim(height)} re f`, { Type: "XObject", Subtype: "Form", BBox: [0, 0, width, height] }),
    );
    annot.set(PDFName.of("AP"), pdf.context.obj({ N: blank }));
    annot.delete(PDFName.of("AS"));
  }
}

function blackPath(rects: readonly UserRect[], ctm: Matrix): Uint8Array {
  const inverse = invert(ctm);
  if (!inverse || rects.length === 0) return new Uint8Array();
  const lines = ["q", "0 0 0 rg"];
  for (const rect of rects) {
    const corners = [
      apply(inverse, rect.x, rect.y),
      apply(inverse, rect.x + rect.width, rect.y),
      apply(inverse, rect.x + rect.width, rect.y + rect.height),
      apply(inverse, rect.x, rect.y + rect.height),
    ];
    const [first, second, third, fourth] = corners;
    if (!first || !second || !third || !fourth) continue;
    lines.push(`${trim(first[0])} ${trim(first[1])} m`);
    lines.push(`${trim(second[0])} ${trim(second[1])} l`);
    lines.push(`${trim(third[0])} ${trim(third[1])} l`);
    lines.push(`${trim(fourth[0])} ${trim(fourth[1])} l`);
    lines.push("h f");
  }
  lines.push("Q");
  return latin1(`\n${lines.join("\n")}\n`);
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 255;
  return out;
}

/** Longest first, so `qBT` and `TjT*` split where pdf-lib omits the space. */
const OPERATORS = ["W*", "T*", "BDC", "BMC", "EMC", "SCN", "scn", "BT", "ET", "Tm", "Td", "TD", "Tj", "TJ", "Tf", "Tc", "Tw", "Tz", "TL", "Tr", "Ts", "Do", "cm", "re", "RG", "rg", "CS", "cs", "SC", "sc", "gs", "BI", "ID", "EI", "MP", "DP", "BX", "EX", "q", "Q", "f*", "f", "F", "m", "l", "c", "v", "y", "h", "S", "s", "n", "W", "w", "J", "j", "M", "d", "i", "b*", "b", "B*", "B", "k", "K", "g", "G", "ri", "sh"];

function splitOperators(word: string, start: number): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < word.length) {
    const found = OPERATORS.find((op) => word.startsWith(op, at));
    const value = found ?? word[at] ?? "";
    tokens.push({ kind: "op", value, start: start + at, end: start + at + value.length });
    at += value.length;
  }
  return tokens;
}

function tokenize(bytes: Uint8Array): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < bytes.length) {
    const token = readToken(bytes, index);
    if (!token) break;
    if (token.token.kind === "op") tokens.push(...splitOperators(token.token.value, token.token.start));
    else tokens.push(token.token);
    index = token.next;
  }
  return tokens;
}

function readToken(bytes: Uint8Array, index: number): { token: Token; next: number } | null {
  let at = index;
  while (at < bytes.length && isSpace(bytes[at] ?? 0)) at += 1;
  if (at >= bytes.length) return null;
  const start = at;
  const byte = bytes[at] ?? 0;
  if (byte === 0x25) {
    while (at < bytes.length && bytes[at] !== 10 && bytes[at] !== 13) at += 1;
    return readToken(bytes, at);
  }
  if (byte === 0x28) return readLiteral(bytes, at);
  if (byte === 0x5b) return readArray(bytes, at);
  if (byte === 0x3c) {
    if (bytes[at + 1] === 0x3c) return readDict(bytes, at);
    return readHex(bytes, at);
  }
  if (byte === 0x2f) return readName(bytes, at);
  if (byte === 0x27 || byte === 0x22) return { token: { kind: "op", value: byte === 0x27 ? "'" : '"', start, end: at + 1 }, next: at + 1 };
  if (isNumberStart(bytes, at)) return readNumber(bytes, at);
  if (isOperatorStart(byte)) return readOperator(bytes, at);
  return readOperator(bytes, at);
}

function readLiteral(bytes: Uint8Array, start: number): { token: Token; next: number } {
  let at = start + 1;
  const out: number[] = [];
  let depth = 1;
  while (at < bytes.length && depth > 0) {
    const byte = bytes[at] ?? 0;
    if (byte === 0x5c) {
      const next = bytes[at + 1] ?? 0;
      const escaped: Record<number, number> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12, 0x28: 0x28, 0x29: 0x29, 0x5c: 0x5c };
      if (escaped[next] !== undefined) {
        out.push(escaped[next]);
        at += 2;
        continue;
      }
      if (next >= 0x30 && next <= 0x37) {
        let value = 0;
        let count = 0;
        while (count < 3 && (bytes[at + 1] ?? 0) >= 0x30 && (bytes[at + 1] ?? 0) <= 0x37) {
          value = value * 8 + ((bytes[at + 1] ?? 0) - 0x30);
          at += 1;
          count += 1;
        }
        out.push(value);
        at += 1;
        continue;
      }
      at += 2;
      continue;
    }
    if (byte === 0x28) depth += 1;
    if (byte === 0x29) {
      depth -= 1;
      if (depth === 0) break;
    }
    out.push(byte);
    at += 1;
  }
  return { token: { kind: "str", bytes: Uint8Array.from(out), start, end: Math.min(bytes.length, at + 1) }, next: Math.min(bytes.length, at + 1) };
}

function readHex(bytes: Uint8Array, start: number): { token: Token; next: number } {
  let at = start + 1;
  let hex = "";
  while (at < bytes.length && bytes[at] !== 0x3e) {
    const byte = bytes[at] ?? 0;
    if (!isSpace(byte)) hex += String.fromCharCode(byte);
    at += 1;
  }
  if (hex.length % 2 === 1) hex += "0";
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return { token: { kind: "str", bytes: out, start, end: Math.min(bytes.length, at + 1) }, next: Math.min(bytes.length, at + 1) };
}

function readArray(bytes: Uint8Array, start: number): { token: Token; next: number } {
  let at = start + 1;
  const items: Token[] = [];
  while (at < bytes.length) {
    while (at < bytes.length && isSpace(bytes[at] ?? 0)) at += 1;
    if (bytes[at] === 0x5d) return { token: { kind: "arr", items, start, end: at + 1 }, next: at + 1 };
    const token = readToken(bytes, at);
    if (!token) break;
    items.push(token.token);
    at = token.next;
  }
  return { token: { kind: "arr", items, start, end: at }, next: at };
}

function readDict(bytes: Uint8Array, start: number): { token: Token; next: number } {
  let at = start + 2;
  let depth = 1;
  while (at < bytes.length && depth > 0) {
    // Strings inside the dictionary may contain << or >>.
    if (bytes[at] === 0x28) {
      at = readLiteral(bytes, at).next;
      continue;
    }
    if (bytes[at] === 0x3c && bytes[at + 1] !== 0x3c) {
      at = readHex(bytes, at).next;
      continue;
    }
    if (bytes[at] === 0x3c && bytes[at + 1] === 0x3c) {
      depth += 1;
      at += 2;
      continue;
    }
    if (bytes[at] === 0x3e && bytes[at + 1] === 0x3e) {
      depth -= 1;
      at += 2;
      continue;
    }
    at += 1;
  }
  return { token: { kind: "dict", start, end: at }, next: at };
}

function readName(bytes: Uint8Array, start: number): { token: Token; next: number } {
  let at = start + 1;
  let value = "";
  while (at < bytes.length && !isDelim(bytes[at] ?? 0)) {
    const byte = bytes[at] ?? 0;
    if (byte === 0x23 && at + 2 < bytes.length) {
      value += String.fromCharCode(Number.parseInt(String.fromCharCode(bytes[at + 1] ?? 0, bytes[at + 2] ?? 0), 16));
      at += 3;
      continue;
    }
    value += String.fromCharCode(byte);
    at += 1;
  }
  return { token: { kind: "name", value, start, end: at }, next: at };
}

function readNumber(bytes: Uint8Array, start: number): { token: Token; next: number } {
  let at = start;
  if (bytes[at] === 0x2b || bytes[at] === 0x2d) at += 1;
  while (at < bytes.length && ((bytes[at] ?? 0) >= 0x30 && (bytes[at] ?? 0) <= 0x39)) at += 1;
  if (bytes[at] === 0x2e) {
    at += 1;
    while (at < bytes.length && ((bytes[at] ?? 0) >= 0x30 && (bytes[at] ?? 0) <= 0x39)) at += 1;
  }
  const text = Buffer.from(bytes.subarray(start, at)).toString("latin1");
  return { token: { kind: "num", value: Number(text), start, end: at }, next: at };
}

function readOperator(bytes: Uint8Array, start: number): { token: Token; next: number } {
  let at = start;
  while (at < bytes.length && isOperatorByte(bytes[at] ?? 0)) at += 1;
  if (at === start) at += 1;
  return { token: { kind: "op", value: Buffer.from(bytes.subarray(start, at)).toString("latin1"), start, end: at }, next: at };
}

function isOperatorByte(byte: number): boolean {
  return (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || byte === 0x2a || byte === 0x27 || byte === 0x22;
}

function isSpace(byte: number): boolean {
  return byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
}

function isDelim(byte: number): boolean {
  return isSpace(byte) || byte === 0x28 || byte === 0x29 || byte === 0x3c || byte === 0x3e || byte === 0x5b || byte === 0x5d || byte === 0x7b || byte === 0x7d || byte === 0x2f || byte === 0x25;
}

function isOperatorStart(byte: number): boolean {
  return (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || byte === 0x2a;
}

function isNumberStart(bytes: Uint8Array, index: number): boolean {
  const byte = bytes[index] ?? 0;
  if (byte >= 0x30 && byte <= 0x39) return true;
  if (byte === 0x2e) return (bytes[index + 1] ?? 0) >= 0x30 && (bytes[index + 1] ?? 0) <= 0x39;
  if (byte === 0x2b || byte === 0x2d) {
    const next = bytes[index + 1] ?? 0;
    return (next >= 0x30 && next <= 0x39) || next === 0x2e;
  }
  return false;
}
