/**
 * MIG-02: the pilot's state and the run report, as the Sign off tab shows them and as the CSV / PDF
 * download carries them. Pure: the database writes the report (app.migration_after_chunk) and
 * decides every step; this only words it. Counts and checksums only, never values from the file.
 */
import type { ReportFile, ReportSection } from "@/modules/sheet/reports-export";

export const PILOT_DEFAULT = 10;

export type PilotBatch = {
  status: string;
  pilot_size: number | null;
  pilot_completed_at: string | null;
  pilot_signed_off_at: string | null;
  full_run_started_at: string | null;
};

/**
 * Where an import stands with its pilot:
 *   ready     checked, the pilot can start (the full run waits for it)
 *   pilot     the pilot's matters are being created
 *   review    the pilot is done and waits for the firm owner's sign-off
 *   signed    signed off; the full run can start
 *   full      the full run is creating the rest
 *   legacy    an import begun before pilots existed, still being created
 *   other     anything else (mapping, imported, rolled back, discarded)
 */
export type PilotState = "ready" | "pilot" | "review" | "signed" | "full" | "legacy" | "other";

export function pilotState(batch: PilotBatch): PilotState {
  if (batch.status === "checked") return "ready";
  if (batch.status !== "committing") return "other";
  if (batch.pilot_size == null) return "legacy";
  if (batch.full_run_started_at) return "full";
  if (!batch.pilot_completed_at) return "pilot";
  return batch.pilot_signed_off_at ? "signed" : "review";
}

/** The pilot size the form offers: the default, or the firm's maximum when that is smaller. */
export function pilotDefault(max: number, ready: number): number {
  return Math.max(1, Math.min(PILOT_DEFAULT, max, Math.max(1, ready)));
}

export type RunReport = {
  generated_at?: string;
  /** MIG-01: the kind of records the file held (absent on a clients and matters report written before it). */
  kind?: string;
  source?: {
    file_name?: string;
    source_system?: string;
    bytes?: number;
    rows_in_file?: number;
    rows_staged?: number;
    sha256?: string;
    staged_digest?: string | null;
    verified_at_upload?: string | null;
    verified_at_commit?: string | null;
    checksum_matches?: boolean;
  };
  records?: Record<string, { created?: number; linked?: number }>;
  totals?: { matters?: number; people_created?: number; people_linked?: number; records_created?: number; records_linked?: number; files_held?: number };
  rows?: {
    rows?: number;
    imported?: number;
    created?: number;
    linked?: number;
    duplicates_found?: number;
    duplicates_same?: number;
    duplicates_different?: number;
    review?: number;
    error?: number;
    skipped?: number;
    exception_lines?: number;
  };
  pilot?: {
    size?: number;
    counts?: { matters?: number; people_created?: number; people_linked?: number; records_created?: number; records_linked?: number } | null;
    completed_at?: string | null;
    signed_off_at?: string | null;
    signed_off_by?: string | null;
    note?: string | null;
  } | null;
  full_run_started_at?: string | null;
};

export function readRunReport(value: unknown): RunReport | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RunReport) : null;
}

const KIND_LABELS: Record<string, string> = {
  matters: "Matters",
  persons: "People",
  tasks: "Tasks",
  matter_staff_notes: "Notes",
  deadlines: "Key dates",
  documents: "Documents",
  person_relationships: "People relationships",
  opening_balances: "Opening balances",
};

/** MIG-01: a report of another kind counts records (one per row), not matters and people. */
function ofRecords(report: RunReport): boolean {
  return Boolean(report.kind && report.kind !== "clients_matters");
}

function pilotWords(report: RunReport): [string, string] {
  const pilot = report.pilot ?? {};
  if (ofRecords(report)) {
    const made = Number(pilot.counts?.records_created ?? 0) + Number(pilot.counts?.records_linked ?? 0);
    return [`${n(made)} of ${n(pilot.size)} records`, `${n(pilot.counts?.records_created)} new, ${n(pilot.counts?.records_linked)} kept as existing`];
  }
  return [`${n(pilot.counts?.matters)} of ${n(pilot.size)} matters`, `${n(pilot.counts?.matters)} matters, ${n(pilot.counts?.people_created)} new people, ${n(pilot.counts?.people_linked)} linked`];
}

/** A record table's name for people: "matter_staff_notes" reads "Notes"; an unknown kind keeps its words. */
export function kindLabel(table: string): string {
  return KIND_LABELS[table] ?? table.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

const n = (value: number | undefined | null) => Number(value ?? 0).toLocaleString("en-CA");

/** "25 Oct 2026, 14:02": a stored time in the firm's timezone. */
export function when(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

export type ReportLine = { term: string; value: string | [string, string] };

/** The report's lines for the Sign off tab. */
export function runReportLines(report: RunReport, timeZone: string): ReportLine[] {
  const source = report.source ?? {};
  const rows = report.rows ?? {};
  const lines: ReportLine[] = [
    { term: "Source counts", value: [`${n(source.rows_in_file)} rows in the file`, `${n(source.rows_staged)} staged`] },
    { term: "Checksum (SHA-256)", value: [source.sha256 ?? "—", source.checksum_matches ? "rows matched it at upload and at commit" : "not verified"] },
  ];
  for (const [table, count] of Object.entries(report.records ?? {})) {
    lines.push({ term: kindLabel(table), value: [`${n(count.created)} created`, `${n(count.linked)} linked to existing`] });
  }
  const records = ofRecords(report);
  lines.push(
    {
      term: "Possible duplicates",
      value: records
        ? [`${n(rows.duplicates_found)} found`, `${n(rows.duplicates_same)} same record, ${n(rows.duplicates_different)} different`]
        : [`${n(rows.duplicates_found)} found`, `${n(rows.duplicates_same)} same person, ${n(rows.duplicates_different)} different people`],
    },
    { term: "Not imported", value: [`${n(rows.error)} with errors, ${n(rows.review)} needing review`, records ? `${n(rows.skipped)} skipped` : `${n(rows.skipped)} skipped with their matter`] },
  );
  if (records && Number(report.totals?.files_held ?? 0) > 0) {
    lines.push({ term: "Files held", value: `${n(report.totals?.files_held)} didn’t pass the upload checks; listed under exceptions` });
  }
  if (report.pilot) {
    lines.push({ term: "Pilot", value: [pilotWords(report)[0], `signed off ${when(report.pilot.signed_off_at, timeZone)}`] });
  }
  return lines;
}

export type RunReportInput = {
  report: RunReport;
  exceptions: { row?: number; column?: string; problem?: string; fix?: string }[];
  firm: string;
  timeZone: string;
  generated: string;
  madeBy: string;
  signedOffBy: string | null;
};

/** The run report as a downloadable file (CSV, or PDF through the reports exporter). */
export function runReportFile(input: RunReportInput): ReportFile {
  const { report, timeZone } = input;
  const source = report.source ?? {};
  const rows = report.rows ?? {};
  const sections: ReportSection[] = [
    {
      title: "Source",
      head: ["Item", "Value"],
      rows: [
        ...(ofRecords(report) ? [["Kind", kindLabel(report.kind ?? "")]] : []),
        ["File", source.file_name ?? "—"],
        ["Source system", source.source_system ?? "—"],
        ["Size (bytes)", n(source.bytes)],
        ["Rows in the file", n(source.rows_in_file)],
        ["Rows staged", n(source.rows_staged)],
        ["SHA-256 of the file", source.sha256 ?? "—"],
        ["Digest of the staged rows", source.staged_digest ?? "—"],
        ["Rows checked at upload", when(source.verified_at_upload, timeZone)],
        ["Rows checked again at commit", when(source.verified_at_commit, timeZone)],
      ],
      note: "The file itself isn’t kept. At upload Casevoya computes the file’s SHA-256 and a digest of every row; before the pilot and the full run it checks the staged rows against that digest again.",
    },
    {
      title: "Record totals",
      head: ["Kind", "Created", "Linked to existing"],
      rows: Object.entries(report.records ?? {}).map(([table, count]) => [kindLabel(table), n(count.created), n(count.linked)]),
    },
    {
      title: "Rows",
      head: ["Rows", "Imported", "New", "Linked", "Possible duplicates", "Same person", "Different people", "Errors", "Needs review", "Skipped"],
      rows: [
        [n(rows.rows), n(rows.imported), n(rows.created), n(rows.linked), n(rows.duplicates_found), n(rows.duplicates_same), n(rows.duplicates_different), n(rows.error), n(rows.review), n(rows.skipped)],
      ],
    },
  ];
  if (report.pilot) {
    sections.push({
      title: "Pilot and sign-off",
      head: ["Item", "Value"],
      rows: [
        [ofRecords(report) ? "Pilot size (records)" : "Pilot size (matters)", n(report.pilot.size)],
        ["Pilot created", pilotWords(report)[1]],
        ["Pilot finished", when(report.pilot.completed_at, timeZone)],
        ["Signed off", when(report.pilot.signed_off_at, timeZone)],
        ["Signed off by", input.signedOffBy ?? "—"],
        ["Note", report.pilot.note ?? "—"],
        ["Full run started", when(report.full_run_started_at, timeZone)],
      ],
    });
  }
  sections.push({
    title: "Exceptions",
    head: ["Row", "Column", "Problem", "Fix"],
    rows: input.exceptions.map((item) => [String(item.row ?? "—"), item.column ?? "—", item.problem ?? "", item.fix ?? ""]),
    note: "Values from your file aren’t kept, so a problem names its column, not the value.",
  });
  return {
    title: `Migration run report, ${input.firm}`,
    meta: [
      ["Import", source.file_name ?? "—"],
      ["Report written", when(report.generated_at, timeZone)],
      ["Generated", input.generated],
      ["Downloaded by", input.madeBy],
      ["Times", timeZone],
    ],
    sections,
    footer: `Migration run report, ${source.file_name ?? ""}, generated ${input.generated}`,
  };
}

/** casevoya-migration-report-<file>-<date>.csv, with the file name made safe. */
export function runReportFilename(fileName: string, today: string, format: "csv" | "pdf"): string {
  const base = fileName.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "import";
  return `casevoya-migration-report-${base}-${today}.${format}`;
}
