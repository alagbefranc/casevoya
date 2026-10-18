/**
 * Migration import (T044, PRD §25 MIG-01, MIG-02), pure: read an uploaded CSV with limits that
 * suit a Worker, and compute the checksums the database verifies. Parsing reuses the leads CSV
 * reader (RFC 4180). Runs on the server; the raw file is never stored.
 */
import { parseCsv } from "@/modules/leads/csv";

export const MIGRATION_MAX_BYTES = 5 * 1024 * 1024;
export const MIGRATION_MAX_ROWS = 5000;
export const MIGRATION_MAX_COLUMNS = 100;
export const MIGRATION_MAX_CELL = 4000;
/** Rows per append_migration_rows call. */
export const MIGRATION_CHUNK = 1000;

export type MigrationFile = {
  headers: string[];
  rows: string[][];
  sha256: string;
  digest: string;
  bytes: number;
};

const SEP = "\u001f";

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return hex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

/** One row's hash: its cells joined by the unit separator (the database computes the same). */
export function rowHash(cells: readonly string[]): Promise<string> {
  return sha256Hex(cells.join(SEP));
}

/** The digest of all rows in order: SHA-256 over the concatenated row hashes. */
export async function rowsDigest(rows: readonly (readonly string[])[]): Promise<string> {
  const hashes: string[] = [];
  for (const row of rows) hashes.push(await rowHash(row));
  return sha256Hex(hashes.join(""));
}

/** The file's bytes as a staged batch, or the first thing that stops it. */
export async function readMigrationFile(bytes: Uint8Array): Promise<MigrationFile | { error: string }> {
  if (bytes.byteLength === 0) return { error: "The file is empty." };
  if (bytes.byteLength > MIGRATION_MAX_BYTES) return { error: "The file is larger than 5 MB. Split it and import each part." };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { error: "Save the file as CSV in UTF-8 and try again." };
  }
  if (text.includes("\u0000")) return { error: "This doesn’t look like a CSV text file." };
  const table = parseCsv(text);
  if (table.length < 2) return { error: "The file needs a header row and at least one row of data." };
  const headers = table[0].map((cell) => cell.trim());
  if (headers.length > MIGRATION_MAX_COLUMNS) return { error: "The file has more than 100 columns." };
  if (headers.some((header) => header.length > 200)) return { error: "A column heading is longer than 200 characters." };
  if (headers.every((header) => !header)) return { error: "The first row needs column headings." };
  const body = table.slice(1);
  if (body.length > MIGRATION_MAX_ROWS) return { error: `The file has ${body.length.toLocaleString("en-CA")} rows. Import up to 5,000 at a time.` };
  const rows = body.map((cells) => cells.slice(0, headers.length));
  for (let index = 0; index < rows.length; index++) {
    if (body[index].length > headers.length && body[index].slice(headers.length).some((cell) => cell.trim())) {
      return { error: `Row ${index + 2} has more values than there are column headings.` };
    }
    if (rows[index].some((cell) => cell.length > MIGRATION_MAX_CELL)) {
      return { error: `Row ${index + 2} has a value longer than 4,000 characters.` };
    }
  }
  return { headers, rows, sha256: await sha256Hex(bytes), digest: await rowsDigest(rows), bytes: bytes.byteLength };
}
