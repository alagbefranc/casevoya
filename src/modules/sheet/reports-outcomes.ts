/**
 * Processing and outcomes (PRD §17 REP-02). Pure: the Reports page loader, the CSV/PDF export and
 * the tests share it.
 *
 * - Segments are program × cohort. The cohort is the calendar quarter, in the firm's timezone, of
 *   the matter's first move to Submitted (the firm's own stage history), e.g. "Submitted Jul–Sep 2026".
 * - Government processing is days from that move to the first move to Decision review, for files
 *   with a consultant-recorded outcome. Pending files (no outcome) are counted apart and never in a
 *   median, range or outcome count. A segment with fewer than MIN_DECIDED timed files hides its
 *   median, range and outcome counts; the sample size (n) is always shown.
 * - Outcomes are counts by recorded outcome. No rate, percentage or ranking is computed: these
 *   describe past files and are nobody's chance of success.
 * - IRCC's own processing-time estimate is never computed or recalled. It is only the newest
 *   licensed-approved GOV-05 entry (government_processing_estimates) on a matter of that program,
 *   shown in its own column as "IRCC's estimate, checked <date>" with its source, never mixed into
 *   the firm's figures.
 */
import type { FirmTimeRow, OutcomeRow } from "@/components/sheet/designer/reports";
import { ESTIMATE_NOTE, estimateSource, fullDay, type EstimateRow } from "@/modules/government/status-provenance";
import { programLabel } from "@/modules/sheet/matters-present";
import { isoDateInTimeZone } from "@/modules/sheet/present";
import { MEDIAN_NOTE, MIN_DECIDED, daysBetween, median, medianLabel } from "@/modules/sheet/reports-present";

export type OutcomeRecord = {
  matterId: string;
  /** The program key of the matter's program pack, or null when none was chosen. */
  program: string | null;
  createdAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
  outcome: string | null;
};

/** The program filter value for matters without a program. */
export const NO_PROGRAM = "none";

/** A program filter from the URL: a program key, or "none". Anything else is no filter. */
export function programFilter(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  return /^[a-z0-9_]{1,60}$/.test(value) ? value : null;
}

export function programName(key: string | null): string {
  return key ? programLabel(key) : "No program selected";
}

const QUARTERS = ["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"];

/** The quarter, in the firm's timezone, an instant falls in: sortable key and label. */
export function quarterCohort(iso: string, timeZone: string): { key: string; label: string } {
  const local = isoDateInTimeZone(new Date(iso), timeZone);
  const year = local.slice(0, 4);
  const quarter = Math.floor((Number(local.slice(5, 7)) - 1) / 3);
  return { key: `${year}-Q${quarter + 1}`, label: `Submitted ${QUARTERS[quarter]} ${year}` };
}

/** Recorded outcomes, in the order of the database enum, as plain words. */
const OUTCOME_WORDS: [string, string][] = [
  ["approved", "approved"],
  ["refused", "refused"],
  ["withdrawn", "withdrawn"],
  ["returned_or_incomplete", "returned or incomplete"],
  ["abandoned", "abandoned"],
  ["other_verified", "other"],
];

/** "4 approved, 1 refused": counts only, never a share or a rate. */
export function outcomeCounts(outcomes: string[]): string {
  const parts: string[] = [];
  for (const [value, words] of OUTCOME_WORDS) {
    const n = outcomes.filter((outcome) => outcome === value).length;
    if (n) parts.push(`${n} ${words}`);
  }
  return parts.join(", ") || "—";
}

export type ProgramEstimate = { text: string; href: string; source: string };

/**
 * Per program, the newest approved IRCC estimate entered on one of its matters (by date checked,
 * then entry). Rows not approved are ignored: an estimate shows only after licensed review.
 */
export function programEstimates(
  estimates: (EstimateRow & { matter_id: string })[],
  programOfMatter: Map<string, string | null>,
  memberName?: (membershipId: string | null) => string,
): Map<string, ProgramEstimate> {
  const newest = new Map<string, EstimateRow>();
  for (const row of estimates) {
    if (row.status !== "approved" || !programOfMatter.has(row.matter_id)) continue;
    const key = programOfMatter.get(row.matter_id) ?? NO_PROGRAM;
    const seen = newest.get(key);
    if (!seen || row.checked_on > seen.checked_on || (row.checked_on === seen.checked_on && row.created_at > seen.created_at)) newest.set(key, row);
  }
  const out = new Map<string, ProgramEstimate>();
  for (const [key, row] of newest) {
    out.set(key, {
      text: `${row.estimate_text} for ${row.application_type}. IRCC’s estimate, checked ${fullDay(row.checked_on)}; ${ESTIMATE_NOTE.replace(/^IRCC’s estimate, /, "")}.`,
      href: row.source_url,
      source: estimateSource(row, memberName),
    });
  }
  return out;
}

export type OutcomeSegments = {
  rows: OutcomeRow[];
  firm: FirmTimeRow[];
  /** Rows whose median, range and outcome counts are hidden (fewer than MIN_DECIDED timed files). */
  hidden: OutcomeRow[];
};

/**
 * Program × quarter segments from the firm's records. `program` narrows to one program (a key or
 * NO_PROGRAM); `linkFor` gives each program cell its filter link (live page only).
 */
export function outcomeSegments(
  records: OutcomeRecord[],
  options: {
    timeZone: string;
    program?: string | null;
    estimates?: Map<string, ProgramEstimate>;
    linkFor?: (programKey: string) => string;
  },
): OutcomeSegments {
  type Group = {
    programKey: string;
    program: string;
    cohortKey: string;
    cohort: string;
    decided: number;
    timedDays: number[];
    outcomes: string[];
    pending: number;
    firmDays: number[];
  };
  const groups = new Map<string, Group>();
  for (const record of records) {
    if (!record.submittedAt) continue;
    const programKey = record.program ?? NO_PROGRAM;
    if (options.program && options.program !== programKey) continue;
    const cohort = quarterCohort(record.submittedAt, options.timeZone);
    const id = `${programKey}|${cohort.key}`;
    const group =
      groups.get(id) ??
      ({ programKey, program: programName(record.program), cohortKey: cohort.key, cohort: cohort.label, decided: 0, timedDays: [], outcomes: [], pending: 0, firmDays: [] } satisfies Group);
    group.firmDays.push(daysBetween(record.createdAt, record.submittedAt));
    if (record.outcome) {
      group.decided++;
      group.outcomes.push(record.outcome);
      if (record.decidedAt && record.decidedAt >= record.submittedAt) group.timedDays.push(daysBetween(record.submittedAt, record.decidedAt));
    } else {
      group.pending++;
    }
    groups.set(id, group);
  }
  const ordered = [...groups.values()].sort((a, b) => a.program.localeCompare(b.program) || b.cohortKey.localeCompare(a.cohortKey));
  const hiddenRows: OutcomeRow[] = [];
  const rows: OutcomeRow[] = ordered.map((group) => {
    const shown = group.timedDays.length >= MIN_DECIDED && group.decided >= MIN_DECIDED;
    const value = shown ? median(group.timedDays) : null;
    const estimate = options.estimates?.get(group.programKey) ?? null;
    const row: OutcomeRow = {
      program: group.program,
      cohort: group.cohort,
      decided: group.decided,
      median: medianLabel(value, "—"),
      pending: group.pending,
      range: shown ? `${Math.min(...group.timedDays)}–${Math.max(...group.timedDays)} (${group.timedDays.length} timed)` : `— (${group.timedDays.length} timed)`,
      outcomes: shown ? outcomeCounts(group.outcomes) : "—",
      estimate: estimate ? { text: estimate.text, href: estimate.href, source: estimate.source } : null,
      programHref: options.linkFor && !options.program ? options.linkFor(group.programKey) : null,
    };
    if (!shown) hiddenRows.push(row);
    return row;
  });
  const firm: FirmTimeRow[] = ordered.map((group) => ({
    program: group.program,
    cohort: group.cohort,
    files: group.firmDays.length,
    median: medianLabel(median(group.firmDays)),
  }));
  return { rows, firm, hidden: hiddenRows };
}

/** The note under the table: which medians are hidden and why, in plain words. */
export function segmentsNote(hidden: OutcomeRow[], total: number): string {
  const tail = "Each matter’s Decisions tab has its own outcome record.";
  if (!total) return `No file has been recorded as submitted yet. ${tail}`;
  if (!hidden.length) return tail;
  if (hidden.length === 1) {
    const row = hidden[0];
    return `${row.program} (${row.cohort.toLowerCase()}) has fewer than ${MIN_DECIDED} decided files with a recorded decision date, so its median, range and outcome counts are hidden. ${tail}`;
  }
  return `${hidden.length} rows have fewer than ${MIN_DECIDED} decided files with a recorded decision date, so their medians, ranges and outcome counts are hidden. ${tail}`;
}

export const OUTCOMES_DEFINITION =
  `Definition: government processing counts days from the first move to Submitted to the first move to Decision review, for files with a consultant-recorded outcome. Pending files are shown apart and never counted in a median, range or outcome count. Cohort is the calendar quarter of the move to Submitted, in the firm’s timezone; the period chips don’t apply here. Range is the shortest and longest of the timed files; n is how many files were timed. ${MEDIAN_NOTE}`;

export const ESTIMATE_DEFINITION =
  "IRCC’s estimate is not the firm’s figure. It is only shown when a staff member entered it from IRCC’s processing-times page on a matter of that program and a licensed member approved it (the newest one per program), with the date it was checked and its source. IRCC says these times are not a maximum or a guarantee.";

export const NO_ESTIMATE_NOTE =
  "No IRCC processing-time estimate has been entered and approved on a matter of these programs, so none is shown. Enter one from a matter’s Government tab; it shows here after licensed review.";
