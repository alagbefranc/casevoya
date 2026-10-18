/**
 * CSV import for leads (CRM-02), pure: parse a file's text, find which column is which lead field,
 * and build the rows the database's import_leads checks again. Runs in the browser.
 */

export type LeadField = "name" | "email" | "phone" | "service_interest" | "source" | "note";

export const LEAD_FIELDS: { field: LeadField; label: string }[] = [
  { field: "name", label: "Name" },
  { field: "email", label: "Email" },
  { field: "phone", label: "Phone" },
  { field: "service_interest", label: "Service interest" },
  { field: "source", label: "Source" },
  { field: "note", label: "First note" },
];

const MAX_ROWS = 500;

/** RFC 4180: commas, quoted fields with "" for a quote, CRLF or LF line ends. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

const HINTS: Record<LeadField, RegExp> = {
  name: /^(full )?name$|^client|^contact name|^person/i,
  email: /e-?mail/i,
  phone: /phone|mobile|cell|tel/i,
  service_interest: /service|interest|program|matter type|need/i,
  source: /source|heard|channel|referr|campaign/i,
  note: /note|comment|message|detail/i,
};

/** Which column (index) each lead field comes from, by its header. A column is used once. */
export function mapColumns(headers: readonly string[]): Record<LeadField, number | null> {
  const used = new Set<number>();
  const pick = (field: LeadField) => {
    const index = headers.findIndex((header, i) => !used.has(i) && HINTS[field].test(header.trim()));
    if (index < 0) return null;
    used.add(index);
    return index;
  };
  const email = pick("email");
  const phone = pick("phone");
  const name = pick("name");
  return { name, email, phone, service_interest: pick("service_interest"), source: pick("source"), note: pick("note") };
}

export type CsvLeadRow = Partial<Record<LeadField, string>>;

export type CsvRead = {
  map: Record<LeadField, number | null>;
  headers: string[];
  rows: CsvLeadRow[];
  /** More rows than one import takes. */
  truncated: boolean;
};

/** The file as lead rows. A "Contact" column holding emails or phone numbers fills whichever fits. */
export function readLeadsCsv(text: string): CsvRead | { error: string } {
  const table = parseCsv(text);
  if (table.length < 2) return { error: "The file needs a header row and at least one lead." };
  const headers = table[0].map((cell) => cell.trim());
  const map = mapColumns(headers);
  const contact = map.email == null && map.phone == null ? headers.findIndex((header) => /contact/i.test(header)) : -1;
  if (map.name == null) return { error: "Add a Name column to the file." };
  if (map.email == null && map.phone == null && contact < 0) return { error: "Add an Email or Phone column to the file." };
  const body = table.slice(1);
  const rows = body.slice(0, MAX_ROWS).map((cells) => {
    const row: CsvLeadRow = {};
    for (const { field } of LEAD_FIELDS) {
      const index = map[field];
      const value = index == null ? "" : (cells[index] ?? "").trim();
      if (value) row[field] = value;
    }
    if (contact >= 0) {
      const value = (cells[contact] ?? "").trim();
      if (value.includes("@")) row.email = value;
      else if (value) row.phone = value;
    }
    return row;
  });
  return { map, headers, rows, truncated: body.length > MAX_ROWS };
}
