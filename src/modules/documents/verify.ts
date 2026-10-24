import "server-only";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { detectMediaType, type DocumentMediaType } from "@/modules/documents/files";

/**
 * Server-side file checks for DOC-02. The bytes are read from Storage by the server,
 * never taken from the browser. The database records only what this module reports.
 */

const DOCX: DocumentMediaType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOCX_MAIN_PART = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const CONTENT_TYPES = "[Content_Types].xml";
const MAX_CONTENT_TYPES_BYTES = 1024 * 1024;
const ZIP_LOCAL = 0x04034b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_END = 0x06054b50;

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function findEndOfCentralDirectory(view: DataView): number {
  const earliest = Math.max(0, view.byteLength - (22 + 0xffff));
  for (let at = view.byteLength - 22; at >= earliest; at -= 1) {
    if (view.getUint32(at, true) === ZIP_END) return at;
  }
  return -1;
}

/** Reads [Content_Types].xml from a ZIP. Returns null for anything malformed, encrypted, or ZIP64. */
function readContentTypes(bytes: Uint8Array): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfCentralDirectory(view);
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
    if (name !== CONTENT_TYPES) continue;

    if ((flags & 0x1) !== 0 || size > MAX_CONTENT_TYPES_BYTES) return null;
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== ZIP_LOCAL) return null;
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (start + compressedSize > bytes.length) return null;
    const data = bytes.subarray(start, start + compressedSize);
    try {
      if (method === 0) return Buffer.from(data).toString("utf8");
      if (method === 8) {
        return inflateRawSync(data, { maxOutputLength: MAX_CONTENT_TYPES_BYTES }).toString("utf8");
      }
    } catch {
      return null;
    }
    return null;
  }
  return null;
}

/**
 * A DOCX is a ZIP whose [Content_Types].xml declares a wordprocessingml main document part and no
 * macro part (DOC-02): a package that declares VBA or a macro-enabled part is refused, never opened.
 */
export function isWordDocument(bytes: Uint8Array): boolean {
  if (!isZip(bytes)) return false;
  const types = readContentTypes(bytes);
  return types != null && types.includes(DOCX_MAIN_PART) && !/vbaProject|macroEnabled|vbaData/i.test(types);
}

/** The verified media type of a whole file, or null. Other ZIPs (XLSX, JAR, plain archives) are rejected. */
export function inspectDocumentBytes(bytes: Uint8Array): DocumentMediaType | null {
  if (isZip(bytes)) return isWordDocument(bytes) ? DOCX : null;
  const detected = detectMediaType(bytes);
  return detected === DOCX ? null : detected;
}

export type VerifiedDocument =
  | { ok: true; byteSize: number; sha256: string; mediaType: DocumentMediaType | null }
  | { ok: false; reason: "too_large" };

/**
 * Hashes and sizes the full stream. Only a ZIP is held in memory (for the DOCX check);
 * other types keep the first bytes only. Stops reading past `limitBytes`.
 */
export async function verifyDocumentStream(
  stream: ReadableStream<Uint8Array>,
  limitBytes: number,
): Promise<VerifiedDocument> {
  const hash = createHash("sha256");
  const reader = stream.getReader();
  const head: number[] = [];
  let keep: Uint8Array[] | null = [];
  let byteSize = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;
      byteSize += value.length;
      if (byteSize > limitBytes) {
        await reader.cancel();
        return { ok: false, reason: "too_large" };
      }
      hash.update(value);
      for (let index = 0; index < value.length && head.length < 64; index += 1) head.push(value[index]);
      if (keep) {
        keep.push(value);
        if (head.length >= 4 && !isZip(Uint8Array.from(head))) keep = null;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const headBytes = Uint8Array.from(head);
  let mediaType: DocumentMediaType | null;
  if (isZip(headBytes) && keep) {
    const whole = new Uint8Array(byteSize);
    let offset = 0;
    for (const chunk of keep) {
      whole.set(chunk, offset);
      offset += chunk.length;
    }
    mediaType = inspectDocumentBytes(whole);
  } else {
    mediaType = inspectDocumentBytes(headBytes);
  }
  return { ok: true, byteSize, sha256: hash.digest("hex"), mediaType };
}
