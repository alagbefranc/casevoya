/**
 * MIG-02: imported records on staff pages. An imported matter's "opened" event is the import, not
 * a native event: it reads "Imported from <system> on <date>" with its original date, and the
 * creation the import performed is not shown as the matter being opened in Casevoya.
 */
import type { FactRow } from "@/components/sheet/designer/clients";
import type { MatterEvent } from "@/components/sheet/designer/matter";
import { importedLabel, importedLine, originalLabel, type Provenance } from "@/modules/migration/provenance";
import { eventWhen } from "@/modules/sheet/matter-present";

/** The import, as the Designer's event row: the import's own date, the original date beside it. */
export function importedEvent(provenance: Provenance, timeZone: string, today: string): MatterEvent {
  return {
    dot: "#c9c5c0",
    title: importedLabel(provenance, timeZone),
    parts: ["Migration import", originalLabel(provenance, timeZone), ...(provenance.reference ? [`old reference ${provenance.reference}`] : [])],
    badge: { tone: "unv", label: "Imported" },
    when: eventWhen(provenance.importedAt, timeZone, today),
  };
}

/**
 * A person's facts with where the recorded ones came from: "Imported from <system> on <date>" while
 * the record is as imported; once someone has changed it, "Person record (imported from …)", since
 * the page can't tell which fact changed. Unrecorded facts keep "Not recorded".
 */
export function importedFacts(facts: FactRow[], provenance: Provenance | null, timeZone: string, version?: number | null): FactRow[] {
  if (!provenance) return facts;
  const label = importedLabel(provenance, timeZone);
  const unchanged = version == null || provenance.versionAtImport == null || version === provenance.versionAtImport;
  const source = unchanged ? label : `Person record (${label.replace(/^Imported/, "imported")})`;
  return facts.map((row) => (row.source === "Person record" ? { ...row, source } : row));
}

/** A task row's provenance line, only for an imported task (no key otherwise). */
export function importedTask(imports: ReadonlyMap<string, Provenance>, id: string, timeZone: string): { imported?: string } {
  const provenance = imports.get(id);
  return provenance ? { imported: importedLine(provenance, timeZone) } : {};
}

/**
 * A matter's recent events with the import in place of the creation it performed: audit rows of
 * the creation actions are left out for an imported matter and the import is shown instead, last
 * (it is the oldest). Native events after the import stay as they are.
 */
export function withImport<T extends { action: string }>(
  rows: readonly T[],
  provenance: Provenance | null,
  creationActions: readonly string[] = ["matter.create"],
): { rows: T[]; imported: boolean } {
  if (!provenance) return { rows: [...rows], imported: false };
  return { rows: rows.filter((row) => !creationActions.includes(row.action)), imported: true };
}

// ---------------------------------------------------------------------------
// MIG follow-ups (gap #187): key dates, documents, relationships and opening balances read
// "Imported from <system> on <date>" too, from the same source (imported_record_provenance).
// ---------------------------------------------------------------------------

/** A key date's origin on the matter's Deadlines tab, with where it came from when imported. */
export function importedOrigin(origin: string, provenance: Provenance | null | undefined, timeZone: string): string {
  return provenance ? `${origin} ${importedLine(provenance, timeZone)}.` : origin;
}

/** The small line under a document's name: where an imported document came from, else as it was. */
export function importedDocumentKind(kind: string, provenance: Provenance | null | undefined, timeZone: string): string {
  return provenance ? importedLine(provenance, timeZone) : kind;
}

/** A matter's relationship row's Evidence cell: an imported relationship says where it came from. */
export function importedEvidence(evidence: string, provenance: Provenance | null | undefined, timeZone: string): string {
  return provenance ? importedLine(provenance, timeZone) : evidence;
}

/** A person's relationship label on the Clients page: the relationship, then where it came from. */
export function importedRelationship(label: string, provenance: Provenance | null | undefined, timeZone: string): string | { left: string; right: string } {
  return provenance ? { left: label, right: importedLine(provenance, timeZone) } : label;
}

/** The provenance line of one record (opening balance, document card), or nothing. */
export function importedNote(imports: ReadonlyMap<string, Provenance>, id: string, timeZone: string): string | null {
  const provenance = imports.get(id);
  return provenance ? importedLine(provenance, timeZone) : null;
}
