#!/usr/bin/env node
// Imports the CICC register list (the full list the College publishes, downloaded by a platform
// admin) into public.cicc_register_imports / public.cicc_register_entries, then re-checks every
// consultant credential against it (public.finish_cicc_register_import). Decision 2026-10-19.
//
// Usage:
//   node scripts/ops/import-cicc-list.mjs <file.csv> --imported-by <platform-admin-user-id>
//        [--note "CICC list downloaded 2026-10-19 from the College"] [--locator "<where the file is kept>"]
//        [--dry-run]
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (the service role) unless --dry-run.
// --imported-by must be a row in public.platform_admins: the import is recorded as theirs.
// The file's sha256 is always recorded; --locator adds where the file itself is stored.
// Prints counts only, never names or numbers.
//
// The College's file format is not known yet. Expected: a CSV (UTF-8, comma-separated, first
// row = headers). Edit COLUMNS below so each field lists the header(s) the file uses (matched
// case-insensitively, first match wins). Columns not mapped are kept as text in college_fields.
//   licence_number  required  e.g. "R512345" (spaces, dots and hyphens are ignored when matching)
//   full_name       required unless first_name and last_name are both mapped
//   first_name      optional
//   last_name       optional  (with first_name, used for the loose name match)
//   status          required  Active / Inactive / Suspended / Revoked (see STATUS_MAP)
//   entitlement     optional  "Yes"/"No": an Active licence with "No" is recorded as not entitled
//   licence_class   optional  e.g. "RCIC", "RCIC-IRB", "RISIA" (kept as text; not matched)
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Configuration: adjust when the College's file arrives.
// ---------------------------------------------------------------------------
const COLUMNS = {
  licence_number: ["Licence Number", "License Number", "Licence #", "Registration Number", "College ID", "Member ID"],
  full_name: ["Name", "Full Name", "Licensee Name"],
  first_name: ["First Name", "Given Name", "Given Names"],
  last_name: ["Last Name", "Surname", "Family Name"],
  status: ["Status", "Licence Status", "License Status"],
  entitlement: ["Entitlement to Practise", "Entitlement to Practice", "Entitled to Practise"],
  licence_class: ["Class", "Licence Class", "License Class", "Licence Type", "Category"],
};

// The list's status words, lowercased, to the four the database understands. A value not listed
// here is sent as it is and the check records "needs review" for that licence.
const STATUS_MAP = {
  active: "Active",
  inactive: "Inactive",
  suspended: "Suspended",
  revoked: "Revoked",
};

const DELIMITER = ",";
const CHUNK = 1000; // rows per RPC call (the database takes up to 5000)

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { file: null, importedBy: null, note: null, locator: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--imported-by") args.importedBy = argv[++i];
    else if (arg === "--note") args.note = argv[++i];
    else if (arg === "--locator") args.locator = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (!arg.startsWith("--") && !args.file) args.file = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.file) throw new Error("Usage: node scripts/ops/import-cicc-list.mjs <file.csv> --imported-by <platform-admin-user-id> [--note ...] [--locator ...] [--dry-run]");
  return args;
}

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF, a leading BOM. */
export function parseCsv(text, delimiter = DELIMITER) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        value += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        value += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(value);
      value = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += ch;
    }
  }
  if (quoted) throw new Error("The CSV ends inside a quoted value.");
  if (value !== "" || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

/** Maps each configured field to a header index; the rest go to college_fields. */
export function mapHeaders(headers, columns = COLUMNS) {
  const lower = headers.map((header) => header.trim().toLowerCase());
  const index = {};
  for (const [field, names] of Object.entries(columns)) {
    const at = names.map((name) => lower.indexOf(name.toLowerCase())).find((i) => i >= 0);
    if (at !== undefined) index[field] = at;
  }
  if (index.licence_number === undefined) throw new Error(`No licence number column. Headers: ${headers.join(" | ")}. Edit COLUMNS.licence_number.`);
  if (index.status === undefined) throw new Error(`No status column. Headers: ${headers.join(" | ")}. Edit COLUMNS.status.`);
  if (index.full_name === undefined && (index.first_name === undefined || index.last_name === undefined)) {
    throw new Error(`No name column (full_name, or first_name and last_name). Headers: ${headers.join(" | ")}. Edit COLUMNS.`);
  }
  const used = new Set(Object.values(index));
  const extra = headers.map((header, i) => [header.trim(), i]).filter(([header, i]) => header && !used.has(i));
  return { index, extra };
}

/** One list row as public.import_cicc_register takes it, or null when it has no licence number. */
export function toRow(cells, { index, extra }, statusMap = STATUS_MAP) {
  const cell = (field) => (index[field] === undefined ? "" : (cells[index[field]] ?? "").trim());
  const number = cell("licence_number");
  if (!number) return null;
  const rawStatus = cell("status");
  const fields = {};
  for (const [header, i] of extra) fields[header] = (cells[i] ?? "").trim();
  return {
    licence_number: number,
    full_name: cell("full_name") || [cell("first_name"), cell("last_name")].filter(Boolean).join(" "),
    first_name: cell("first_name") || null,
    last_name: cell("last_name") || null,
    status: statusMap[rawStatus.toLowerCase()] ?? rawStatus,
    entitlement: cell("entitlement") || null,
    licence_class: cell("licence_class") || null,
    fields,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = path.resolve(args.file);
  const bytes = readFileSync(file);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const [headers, ...body] = parseCsv(bytes.toString("utf8"));
  if (!headers) throw new Error("The CSV is empty.");
  const mapping = mapHeaders(headers);
  const rows = [];
  let skipped = 0;
  const statuses = new Map();
  for (const cells of body) {
    const row = toRow(cells, mapping);
    if (!row) {
      skipped += 1;
      continue;
    }
    statuses.set(row.status, (statuses.get(row.status) ?? 0) + 1);
    rows.push(row);
  }
  const unrecognised = [...statuses.keys()].filter((status) => !Object.values(STATUS_MAP).includes(status));
  console.log(`File sha256 ${sha256}`);
  console.log(`Mapped: ${Object.entries(mapping.index).map(([field, i]) => `${field} <- "${headers[i].trim()}"`).join(", ")}`);
  console.log(`Kept as college_fields: ${mapping.extra.map(([header]) => header).join(", ") || "none"}`);
  console.log(`Rows: ${rows.length} to import, ${skipped} skipped without a licence number.`);
  console.log(`Statuses: ${[...statuses.entries()].map(([status, n]) => `${status} ${n}`).join(", ")}`);
  if (unrecognised.length) console.log(`Not recognised (each such licence will need review): ${unrecognised.join(", ")}. Add them to STATUS_MAP if they mean Active/Inactive/Suspended/Revoked.`);
  if (args.dryRun) {
    console.log("Dry run: nothing was sent.");
    return;
  }
  if (!rows.length) throw new Error("No rows to import.");
  if (!args.importedBy || !/^[0-9a-f-]{36}$/i.test(args.importedBy)) throw new Error("--imported-by <platform-admin-user-id> is required.");
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"]) {
    if (!process.env[name]) throw new Error(`${name} is not set.`);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const note = args.note ?? `CICC register list ${path.basename(file)} imported ${new Date().toISOString().slice(0, 10)}`;
  const { data: importId, error: startError } = await admin.rpc("start_cicc_register_import", {
    p_source_note: note.slice(0, 500),
    p_file_locator: args.locator,
    p_file_sha256: sha256,
    p_imported_by: args.importedBy,
  });
  if (startError) throw new Error(`start_cicc_register_import: ${startError.message}`);
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await admin.rpc("import_cicc_register", { p_import_id: importId, p_rows: rows.slice(i, i + CHUNK) });
    if (error) throw new Error(`import_cicc_register (rows ${i + 1}-${Math.min(i + CHUNK, rows.length)}): ${error.message}. Import ${importId} stays open and unused.`);
    console.log(`Sent ${Math.min(i + CHUNK, rows.length)} of ${rows.length}`);
  }
  const { data: summary, error: finishError } = await admin.rpc("finish_cicc_register_import", { p_import_id: importId });
  if (finishError) throw new Error(`finish_cicc_register_import: ${finishError.message}`);
  console.log(`Import ${importId} complete: ${JSON.stringify(summary)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
