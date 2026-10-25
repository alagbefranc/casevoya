/**
 * MIG-02: how an imported record reads wherever it shows ("Imported from <system> on <date>"),
 * with its original date when the import had one. Imported history is never shown as an event
 * that happened in Casevoya. Pure; the rows come from public.imported_record_provenance.
 */

export type Provenance = {
  id: string;
  system: string;
  importedAt: string;
  originalAt: string | null;
  reference: string | null;
  created: boolean;
  /** The record's version when it was imported: a later version means someone changed it since. */
  versionAtImport: number | null;
};

/** The provenance rows the database returns, keyed by record id. Anything malformed is left out. */
export function readProvenance(value: unknown): Map<string, Provenance> {
  const map = new Map<string, Provenance>();
  if (!Array.isArray(value)) return map;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.imported_at !== "string") continue;
    map.set(row.id, {
      id: row.id,
      system: typeof row.system === "string" && row.system.trim() ? row.system.trim() : "another system",
      importedAt: row.imported_at,
      originalAt: typeof row.original_at === "string" ? row.original_at : null,
      reference: typeof row.reference === "string" && row.reference ? row.reference : null,
      created: row.created !== false,
      versionAtImport: typeof row.version_at_import === "number" ? row.version_at_import : null,
    });
  }
  return map;
}

/** "4 Mar 2019": a day in the firm's timezone. */
export function provenanceDay(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "an unknown date";
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(date);
}

/** "Imported from Clio on 25 Oct 2026". */
export function importedLabel(provenance: Provenance, timeZone: string): string {
  return `Imported from ${provenance.system} on ${provenanceDay(provenance.importedAt, timeZone)}`;
}

/** "originally 4 Mar 2019", or "original date not in the file". */
export function originalLabel(provenance: Provenance, timeZone: string): string {
  return provenance.originalAt ? `originally ${provenanceDay(provenance.originalAt, timeZone)}` : "original date not in the file";
}

/** "Imported from Clio on 25 Oct 2026 (originally 4 Mar 2019)": one line for a list row. */
export function importedLine(provenance: Provenance, timeZone: string): string {
  return provenance.originalAt ? `${importedLabel(provenance, timeZone)} (${originalLabel(provenance, timeZone)})` : importedLabel(provenance, timeZone);
}
