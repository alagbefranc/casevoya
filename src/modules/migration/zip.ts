import "server-only";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { UPLOAD_CEILING_BYTES } from "@/modules/documents/files";
import { inspectDocumentBytes } from "@/modules/documents/verify";

/**
 * MIG-01 documents import: reads the ZIP that comes with a manifest CSV, on the server. Only the
 * central directory and one entry at a time are read; the ZIP itself is never stored. Each entry's
 * bytes are hashed and their type detected by the same checks as a document upload (DOC-02). A ZIP
 * that is encrypted, ZIP64, or uses another compression method is refused entry by entry, never
 * trusted. Folders and macOS resource files are skipped.
 */

export const MIGRATION_ZIP_MAX_BYTES = 25 * 1024 * 1024;
export const MIGRATION_ZIP_MAX_FILES = 1000;
/** All entries together, uncompressed: a ZIP that inflates past this is refused (a "zip bomb"). */
export const MIGRATION_ZIP_MAX_EXPANDED = 200 * 1024 * 1024;

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;

export type ZipEntry = {
  path: string;
  baseName: string;
  method: number;
  flags: number;
  compressedSize: number;
  size: number;
  localOffset: number;
};

export type ZipFileRow = {
  path: string;
  base_name: string;
  byte_size: number;
  sha256: string | null;
  media_type: string | null;
  problem: string | null;
};

function findEnd(view: DataView): number {
  const earliest = Math.max(0, view.byteLength - (22 + 0xffff));
  for (let at = view.byteLength - 22; at >= earliest; at -= 1) {
    if (view.getUint32(at, true) === END) return at;
  }
  return -1;
}

/** A path inside the ZIP as the manifest names it: forward slashes, no leading slash, no "..". */
export function cleanZipPath(raw: string): string | null {
  const path = raw.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!path || path.startsWith("/") || /^[a-z]:/i.test(path) || path.split("/").some((part) => part === "..")) return null;
  if (path.length > 300 || path.includes("\u0000")) return null;
  return path;
}

/** The ZIP's file entries from its central directory, or why it can't be read. */
export function listZipEntries(bytes: Uint8Array): ZipEntry[] | { error: string } {
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return { error: "That isn’t a ZIP file." };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEnd(view);
  if (end < 0) return { error: "The ZIP is damaged. Make it again and try again." };
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const offset = view.getUint32(end + 16, true);
  if (count === 0xffff || offset === 0xffffffff || offset + size > end) return { error: "Large (ZIP64) archives aren’t supported. Split the files into smaller ZIPs." };
  const entries: ZipEntry[] = [];
  let at = offset;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > end || view.getUint32(at, true) !== CENTRAL) return { error: "The ZIP is damaged. Make it again and try again." };
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const entrySize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    if (at + 46 + nameLength > end) return { error: "The ZIP is damaged. Make it again and try again." };
    const raw = new TextDecoder("utf-8").decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (raw.endsWith("/") || raw.startsWith("__MACOSX/") || raw.split("/").pop()?.startsWith("._")) continue;
    const path = cleanZipPath(raw) ?? raw.slice(0, 300);
    entries.push({ path, baseName: path.split("/").pop() || path, method, flags, compressedSize, size: entrySize, localOffset });
    if (entries.length > MIGRATION_ZIP_MAX_FILES) return { error: "The ZIP has more than 1,000 files. Split it." };
  }
  return entries;
}

/** One entry's bytes, or why it can't be read. Checks the size the directory declared. */
export function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array | { problem: string } {
  if (cleanZipPath(entry.path) == null) return { problem: "The file’s path in the ZIP isn’t allowed" };
  if ((entry.flags & 0x1) !== 0) return { problem: "The file is encrypted in the ZIP" };
  if (entry.size > UPLOAD_CEILING_BYTES) return { problem: "The file is larger than 100 MB" };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (entry.localOffset + 30 > bytes.length || view.getUint32(entry.localOffset, true) !== LOCAL) return { problem: "The file is damaged in the ZIP" };
  const start = entry.localOffset + 30 + view.getUint16(entry.localOffset + 26, true) + view.getUint16(entry.localOffset + 28, true);
  if (start + entry.compressedSize > bytes.length) return { problem: "The file is damaged in the ZIP" };
  const data = bytes.subarray(start, start + entry.compressedSize);
  let out: Uint8Array;
  try {
    if (entry.method === 0) out = data;
    else if (entry.method === 8) out = new Uint8Array(inflateRawSync(data, { maxOutputLength: Math.max(1, entry.size) }));
    else return { problem: "The file uses a compression the import can’t read" };
  } catch {
    return { problem: "The file is damaged in the ZIP" };
  }
  if (out.length !== entry.size) return { problem: "The file is damaged in the ZIP" };
  return out;
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** What the database keeps about each entry: path, size, SHA-256, detected type, or a problem. */
export function describeZip(bytes: Uint8Array): { files: ZipFileRow[]; sha256: string } | { error: string } {
  if (bytes.length > MIGRATION_ZIP_MAX_BYTES) return { error: "The ZIP is larger than 25 MB. Split the files into smaller ZIPs." };
  const entries = listZipEntries(bytes);
  if ("error" in entries) return entries;
  const seen = new Set<string>();
  const files: ZipFileRow[] = [];
  let expanded = 0;
  for (const entry of entries) {
    if (seen.has(entry.path)) return { error: "The ZIP names one file twice." };
    seen.add(entry.path);
    expanded += entry.size;
    if (expanded > MIGRATION_ZIP_MAX_EXPANDED) return { error: "The ZIP’s files add up to more than 200 MB. Split them into smaller ZIPs." };
    const read = readZipEntry(bytes, entry);
    if ("problem" in read) {
      files.push({ path: entry.path, base_name: entry.baseName, byte_size: entry.size, sha256: null, media_type: null, problem: read.problem });
      continue;
    }
    files.push({ path: entry.path, base_name: entry.baseName, byte_size: read.length, sha256: sha256Bytes(read), media_type: inspectDocumentBytes(read), problem: null });
  }
  return { files, sha256: sha256Bytes(bytes) };
}

/** One file's bytes by its path, checked against the SHA-256 the dry run read. */
export function zipFileBytes(bytes: Uint8Array, path: string, sha256: string): Uint8Array | null {
  const entries = listZipEntries(bytes);
  if ("error" in entries) return null;
  const entry = entries.find((item) => item.path === path);
  if (!entry) return null;
  const read = readZipEntry(bytes, entry);
  if ("problem" in read || sha256Bytes(read) !== sha256) return null;
  return read;
}
