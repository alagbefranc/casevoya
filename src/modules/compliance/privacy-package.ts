import type { ExportExcluded, ExportRecordSet } from "@/modules/exports/package";

/**
 * SEC-06: what goes into a privacy access response, from the scope search items and the rows read
 * for them. Pure: the server reads the rows as the staff member and passes them here. A withheld
 * item is left out and listed with the reason staff gave (never the third party's name); a withheld
 * field is replaced by WITHHELD in every row of that item.
 */

export type PackageItem = {
  id: string;
  source: string;
  source_id: string;
  label: string;
  decision: string;
  withheld_fields: string[];
  reason: string | null;
};

export const WITHHELD = "[withheld]";

const PATH: Record<string, string> = {
  person: "records/client-record.json",
  matter: "records/matters.json",
  document: "records/documents.json",
  message_thread: "records/messages.json",
  intake_response: "records/intake-forms.json",
  intake_answer: "records/intake-answers.json",
  invoice: "records/invoices.json",
  invoice_payment: "records/invoice-payments.json",
  consent: "records/consents.json",
  booking: "records/consultations.json",
  lead: "records/enquiries.json",
  audit: "records/activity-log.json",
};

export function redactRow(row: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  if (!fields.length) return row;
  const out: Record<string, unknown> = { ...row };
  for (const field of fields) if (field in out) out[field] = WITHHELD;
  return out;
}

/**
 * Intake answers are withheld by field key (the item's fields are the form's field keys): the
 * answer's values are replaced, its key stays so the person sees something was withheld.
 */
export function redactAnswer(row: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  if (!fields.includes(String(row.field_key ?? ""))) return row;
  const out: Record<string, unknown> = { ...row };
  for (const key of ["raw_value", "normalized_value", "calendar_date", "year_value", "month_value", "approximate_note"]) if (key in out) out[key] = WITHHELD;
  return out;
}

/** Rows read for one item, keyed by the record set they belong to (e.g. invoice and invoice_payment). */
export type ItemRows = Record<string, Record<string, unknown>[]>;

export function assemblePrivacyRecords(
  items: PackageItem[],
  rowsByItem: Map<string, ItemRows>,
): { records: ExportRecordSet[]; excluded: ExportExcluded[]; withheld: { record: string; reason: string }[] } {
  const sets = new Map<string, Record<string, unknown>[]>();
  const excluded: ExportExcluded[] = [];
  const withheld: { record: string; reason: string }[] = [];
  for (const item of items) {
    if (item.decision === "withhold") {
      const reason = item.reason ?? "Withheld";
      withheld.push({ record: item.label, reason });
      excluded.push({ path: PATH[item.source] ?? `records/${item.source}.json`, source: item.source, sourceId: item.source_id, reason: `Withheld: ${reason}` });
      continue;
    }
    const fields = item.decision === "redact" ? item.withheld_fields : [];
    if (fields.length) withheld.push({ record: item.label, reason: `${fields.join(", ")} withheld: ${item.reason ?? "withheld"}` });
    const rows = rowsByItem.get(item.id);
    if (!rows) {
      excluded.push({ path: PATH[item.source] ?? `records/${item.source}.json`, source: item.source, sourceId: item.source_id, reason: "Not included: the record could not be read." });
      continue;
    }
    for (const [set, list] of Object.entries(rows)) {
      const target = sets.get(set) ?? [];
      for (const row of list) target.push(set === "intake_answer" ? redactAnswer(row, fields) : redactRow(row, fields));
      sets.set(set, target);
    }
  }
  const records: ExportRecordSet[] = [...sets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([set, rows]) => ({ path: PATH[set] ?? `records/${set}.json`, source: set, rows }));
  records.push({ path: "withheld.json", source: "withheld", rows: withheld });
  return { records, excluded, withheld };
}
