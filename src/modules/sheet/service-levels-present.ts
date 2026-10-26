/**
 * ADM-04: the firm's service-level report on Settings > Security (firm owner), from
 * public.service_level_report. Only what real rows prove is shown: support response times come
 * from the support requests Casevoya recorded for the firm (median, longest and how many, per month
 * in the firm's timezone); uptime is "Not measured yet" because Casevoya records no uptime
 * monitoring. No figure is ever filled in or estimated.
 */
import type { SecurityRow } from "@/components/sheet/designer/settings";

export type SupportMonth = {
  /** "YYYY-MM" in the firm's timezone. */
  month: string;
  received: number;
  answered: number;
  waiting: number;
  medianSeconds: number | null;
  longestSeconds: number | null;
};

export type ServiceLevelReport = {
  /** False until a monitoring source exists. */
  uptimeMeasured: boolean;
  /** Newest first. */
  months: SupportMonth[];
};

function count(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function seconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/** Reads the RPC's jsonb; null when it isn't the expected shape. */
export function parseServiceLevelReport(raw: unknown): ServiceLevelReport | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = raw as { uptime?: { measured?: unknown }; months?: unknown };
  if (!Array.isArray(data.months)) return null;
  const months: SupportMonth[] = [];
  for (const item of data.months) {
    if (!item || typeof item !== "object") continue;
    const row = item as { month?: unknown; support?: Record<string, unknown> };
    if (typeof row.month !== "string" || !/^\d{4}-\d{2}$/.test(row.month)) continue;
    const support = row.support ?? {};
    const answered = count(support.answered);
    months.push({
      month: row.month,
      received: count(support.received),
      answered,
      waiting: count(support.waiting),
      medianSeconds: answered ? seconds(support.median_seconds) : null,
      longestSeconds: answered ? seconds(support.longest_seconds) : null,
    });
  }
  return { uptimeMeasured: data.uptime?.measured === true, months };
}

/** "October 2026" for "2026-10". */
export function monthLabel(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, mon - 1, 1)));
}

/** A response time in plain words: "under 1 min", "25 min", "2 h 5 min", "1 d 3 h". */
export function durationLabel(total: number): string {
  if (total < 60) return "under 1 min";
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return restMinutes ? `${hours} h ${restMinutes} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} d ${restHours} h` : `${days} d`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function monthPart(row: SupportMonth): string {
  const parts: string[] = [];
  if (row.answered && row.medianSeconds !== null && row.longestSeconds !== null) {
    parts.push(`median ${durationLabel(row.medianSeconds)}`, `longest ${durationLabel(row.longestSeconds)}`, `${row.answered} answered`);
  } else {
    parts.push("none answered yet");
  }
  if (row.waiting) parts.push(`${row.waiting} waiting`);
  return `${monthLabel(row.month)}: ${plural(row.received, "request")}, ${parts.join(", ")}`;
}

/** How many months with requests the row's detail lists. */
const MONTHS_SHOWN = 3;

export const UPTIME_NOT_MEASURED = "Not measured yet";

/**
 * The Security tab's service-level rows for the firm owner: Uptime, then Support response time.
 * Empty when the report couldn't be read (not the owner, or the database refused).
 */
export function serviceLevelRows(report: ServiceLevelReport | null): SecurityRow[] {
  if (!report) return [];
  // Hook: the report says measured only once a monitoring source fills it (none does today); the
  // figures it would carry are not defined yet, so this row has no measured form to show.
  const uptime: SecurityRow | null = report.uptimeMeasured
    ? null
    : {
        title: "Uptime",
        detail: "Casevoya doesn’t monitor uptime yet. A figure appears once an external monitor checks the live site",
        badge: { tone: "gr", label: UPTIME_NOT_MEASURED },
      };
  const span = report.months.length;
  const withRequests = report.months.filter((row) => row.received > 0);
  // ADM-04 decision (2026-10-25): the support response target.
  const lead = "Time from your request reaching Casevoya support to its first reply, by month in your timezone. Target: first response within 1 business day";
  let support: SecurityRow;
  if (!withRequests.length) {
    support = {
      title: "Support response time",
      detail: `${lead}. No support requests from your firm are recorded in the last ${plural(span, "month")}`,
      badge: { tone: "gr", label: "None recorded" },
    };
  } else {
    const latestAnswered = withRequests.find((row) => row.answered > 0 && row.medianSeconds !== null);
    const waiting = withRequests.reduce((sum, row) => sum + row.waiting, 0);
    support = {
      title: "Support response time",
      detail: `${lead}. ${withRequests.slice(0, MONTHS_SHOWN).map(monthPart).join(" · ")}`,
      badge: latestAnswered
        ? { tone: "gr", label: `Median ${durationLabel(latestAnswered.medianSeconds ?? 0)}` }
        : { tone: "chg", label: `${waiting} waiting` },
    };
  }
  return uptime ? [uptime, support] : [support];
}
