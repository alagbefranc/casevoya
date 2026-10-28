import { Buffer } from "node:buffer";
import { inflateRawSync } from "node:zlib";

/**
 * DOC-05: a Word document's text for Vo to read. A DOCX is a ZIP; its body is word/document.xml.
 * Only that part's text is taken (paragraphs, tabs and line breaks kept); nothing in the file is
 * run, and a file with macros never got past the upload check. Null for anything that isn't a
 * readable, unencrypted DOCX, or has no text. Shared by the Vo agent service and the tests.
 */

const ZIP_LOCAL = 0x04034b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_END = 0x06054b50;
/** The document part is read up to 8 MB of XML; the text Vo receives is capped below. */
const MAX_PART_BYTES = 8 * 1024 * 1024;
/** Text sent to the model: about 100 pages of plain text. */
export const DOCX_TEXT_LIMIT = 200_000;

function readEntry(bytes: Uint8Array, wanted: string): Buffer | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = view.byteLength - 22; at >= Math.max(0, view.byteLength - (22 + 0xffff)); at -= 1) {
    if (view.getUint32(at, true) === ZIP_END) {
      end = at;
      break;
    }
  }
  if (end < 0) return null;
  const entries = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (entries === 0xffff || directoryOffset === 0xffffffff || directoryOffset + directorySize > end) return null;
  let at = directoryOffset;
  for (let index = 0; index < entries; index += 1) {
    if (at + 46 > end || view.getUint32(at, true) !== ZIP_CENTRAL) return null;
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    if (at + 46 + nameLength > end) return null;
    const name = Buffer.from(bytes.subarray(at + 46, at + 46 + nameLength)).toString("utf8");
    at += 46 + nameLength + extraLength + commentLength;
    if (name !== wanted) continue;
    if ((flags & 0x1) !== 0 || size > MAX_PART_BYTES) return null;
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== ZIP_LOCAL) return null;
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (start + compressedSize > bytes.length) return null;
    const data = bytes.subarray(start, start + compressedSize);
    try {
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES });
    } catch {
      return null;
    }
    return null;
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity: string) => {
    if (entity[0] !== "#") return ENTITIES[entity.toLowerCase()] ?? whole;
    const code = entity[1].toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/** The text of a DOCX's main document part, or null. */
export function docxText(bytes: Uint8Array): string | null {
  const part = readEntry(bytes, "word/document.xml");
  if (!part) return null;
  const xml = part.toString("utf8");
  const text = decode(
    xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:(br|cr)\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text ? text.slice(0, DOCX_TEXT_LIMIT) : null;
}
