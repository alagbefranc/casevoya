/**
 * Pure helpers for the Reports page (PRD §17 REP-01..03, TASKS T041). Every number on the page is
 * computed from the firm's own records by these functions, and each metric's definition is
 * written here so the page, the CSV and the PDF say the same thing. No benchmark, target or
 * government processing estimate is invented: firm work time and government processing are
 * measured separately, from the firm's own stage history.
 */
import type { ReportBar, ReportRange, ReportsTab } from "@/components/sheet/designer/reports";
import { plusDays, stageLabel } from "@/modules/sheet/present";
import { safeZone } from "@/modules/scheduling/format";
import { localToUtc } from "@/modules/scheduling/slots";
import { isOverdue } from "@/modules/sheet/tasks-present";

export const REPORT_TABS: readonly ReportsTab[] = ["ops", "money", "outcomes", "scheduled"];

/** Who sees which tab. RLS still decides which rows each person can read. */
export const OPS_ROLES = new Set(["firm_owner", "licensed_consultant", "case_manager"]);
export const MONEY_ROLES = new Set(["firm_owner", "finance_user"]);

/** Rows with fewer decided files than this hide their median (REP-02: show sample size, avoid over-reading small samples). */
export const MIN_DECIDED = 5;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = MONTHS.map((name) => name.slice(0, 3));

export function reportsTab(raw: string | undefined): ReportsTab {
  return (REPORT_TABS as readonly string[]).includes(raw ?? "") ? (raw as ReportsTab) : "ops";
}

export function reportRange(raw: string | undefined): ReportRange {
  return raw === "month" || raw === "year" ? raw : "90d";
}

export const RANGE_LABEL: Record<ReportRange, string> = { "90d": "Last 90 days", month: "This month", year: "This year" };

/** The first day of the range (inclusive) for a firm-local `today`. */
export function rangeStart(range: ReportRange, today: string): string {
  if (range === "month") return `${today.slice(0, 7)}-01`;
  if (range === "year") return `${today.slice(0, 4)}-01-01`;
  return plusDays(today, -89);
}

/** "1 Jul – 16 Oct 2026", or "1 Dec 2025 – 16 Feb 2026" across a year. */
export function rangeLabel(from: string, to: string): string {
  const part = (iso: string, year: boolean) => {
    const [y, m, d] = iso.split("-").map(Number);
    return `${d} ${SHORT[m - 1]}${year ? ` ${y}` : ""}`;
  };
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${part(from, !sameYear)} – ${part(to, true)}`;
}

/** Whole days between two instants or dates, never negative. */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso.length === 10 ? `${fromIso}T12:00:00Z` : fromIso);
  const b = Date.parse(toIso.length === 10 ? `${toIso}T12:00:00Z` : toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

/** The middle value (the lower of the two middles for an even count, so it is a real file's figure). */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

export function percent(part: number, whole: number): number {
  return whole ? Math.round((part / whole) * 100) : 0;
}

// ---------- Operations ----------

export type BookingInput = { id: string; status: string; matterId: string | null };

/** The consultation funnel: booked, completed, a matter opened from it, that matter engaged. */
export function leadFunnel(bookings: BookingInput[], rescheduled: Set<string>, engaged: Set<string>) {
  const booked = bookings.filter((row) => BOOKED.has(row.status));
  const completed = booked.filter((row) => row.status === "completed");
  const withMatter = booked.filter((row) => row.matterId);
  const engagedRows = withMatter.filter((row) => row.matterId && engaged.has(row.matterId));
  const bars: ReportBar[] = [
    // Only consultations that have started count here (completed and no-show can't happen yet
    // for the others), so the label says so.
    { label: "Booked for dates so far", count: booked.length, tone: "" },
    { label: "Consultation completed", count: completed.length, tone: "" },
    { label: "Matter opened", count: withMatter.length, tone: "" },
    { label: "Engaged", count: engagedRows.length, tone: "" },
  ];
  const note = booked.length
    ? `${engagedRows.length} of ${booked.length} consultations led to an engaged matter (${percent(engagedRows.length, booked.length)}%).`
    : "No booked consultation has started in this period yet. Upcoming ones are on the Consultations page.";
  return {
    bars,
    note,
    attendance: {
      booked: booked.length,
      attended: completed.length,
      rescheduled: booked.filter((row) => rescheduled.has(row.id)).length,
      noShow: booked.filter((row) => row.status === "no_show").length,
    },
  };
}

/** A booking that was actually made: not an unpaid hold or an expired one. */
const BOOKED = new Set(["confirmed", "completed", "no_show", "cancelled"]);

export type OpenMatterInput = { id: string; stage: string; createdAt: string; stageSince: string | null };

/** Open matters by stage, in stage order, with median and oldest whole days in the current stage. */
export function stageAgeing(matters: OpenMatterInput[], stageOrder: readonly string[], now: string) {
  const byStage = new Map<string, number[]>();
  for (const matter of matters) {
    if (matter.stage === "closed") continue;
    const days = daysBetween(matter.stageSince ?? matter.createdAt, now);
    byStage.set(matter.stage, [...(byStage.get(matter.stage) ?? []), days]);
  }
  return stageOrder
    .filter((stage) => byStage.has(stage))
    .map((stage) => {
      const days = byStage.get(stage) ?? [];
      return { stage: stageLabel(stage), matters: days.length, median: String(median(days) ?? 0), oldest: String(Math.max(...days)) };
    });
}

export type WorkloadTask = { ownerMembershipId: string | null; matterId: string | null; dueOn: string | null; dueAt?: string | null; status: string };
export type WorkloadMatter = { id: string; consultantMembershipId: string | null };

/** Per active staff member: open internal tasks they own, how many are overdue, and their matters. */
export function workload(
  staff: { id: string; name: string }[],
  tasks: WorkloadTask[],
  openMatters: WorkloadMatter[],
  today: string,
  /** With `now`, overdue follows the Tasks page's rule (a due time before now counts too). */
  now?: Date,
) {
  const late = (task: WorkloadTask) => (now ? isOverdue(task.dueOn, task.dueAt ?? null, today, now) : task.dueOn !== null && task.dueOn < today);
  return staff
    .map((person) => {
      const own = tasks.filter((task) => task.ownerMembershipId === person.id && (task.status === "open" || task.status === "blocked"));
      const matters = new Set<string>();
      for (const task of own) if (task.matterId) matters.add(task.matterId);
      for (const matter of openMatters) if (matter.consultantMembershipId === person.id) matters.add(matter.id);
      return {
        person: person.name,
        open: own.length,
        overdue: own.filter(late).length,
        matters: matters.size,
      };
    })
    .sort((a, b) => a.person.localeCompare(b.person));
}

export type DocRequestInput = { status: string; expiresOn: string | null; reviewState: string | null; hasDocument: boolean };

/** Open document requests by where they are waiting. */
export function outstandingDocuments(requests: DocRequestInput[], today: string): ReportBar[] {
  let missing = 0;
  let review = 0;
  let changes = 0;
  let expired = 0;
  for (const request of requests) {
    if (request.status !== "open") continue;
    if (request.expiresOn && request.expiresOn < today) expired++;
    else if (!request.hasDocument || request.reviewState === null) missing++;
    else if (request.reviewState === "rejected") changes++;
    else if (request.reviewState === "pending") review++;
    else missing++;
  }
  return [
    { label: "Requested, not uploaded", count: missing, tone: "w" },
    { label: "Awaiting review", count: review, tone: "" },
    { label: "Changes requested", count: changes, tone: "w" },
    { label: "Expired", count: expired, tone: "g" },
  ];
}

// ---------- Money ----------

export type InvoiceInput = {
  status: string;
  currency: string;
  amountCents: number;
  paidCents: number;
  creditedCents: number;
  dueOn: string;
  issuedOn: string | null;
};

const OPEN_INVOICE = new Set(["issued", "partially_paid"]);

export function owedCents(invoice: InvoiceInput): number {
  return Math.max(0, invoice.amountCents - invoice.paidCents - invoice.creditedCents);
}

/** Open CAD invoices by days past their due date. */
export function receivablesAgeing(invoices: InvoiceInput[], today: string) {
  const buckets = [
    { age: "Not due", invoices: 0, cents: 0 },
    { age: "1–30 days overdue", invoices: 0, cents: 0 },
    { age: "31–60 days", invoices: 0, cents: 0 },
    { age: "61–90 days", invoices: 0, cents: 0 },
    { age: "Over 90 days", invoices: 0, cents: 0 },
  ];
  for (const invoice of invoices) {
    if (invoice.currency.toUpperCase() !== "CAD" || !OPEN_INVOICE.has(invoice.status)) continue;
    const owed = owedCents(invoice);
    if (owed <= 0) continue;
    const late = invoice.dueOn >= today ? 0 : daysBetween(invoice.dueOn, today);
    const index = late === 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
    buckets[index].invoices++;
    buckets[index].cents += owed;
  }
  return buckets;
}

/** The calendar months a range touches, oldest first: `YYYY-MM`. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * "August", "October to date" for the current month, "December 2025" outside the current year.
 * With the range's first day (`from`), a first month that starts part-way says so: "July from 19 Jul".
 */
export function monthLabel(month: string, today: string, from?: string): string {
  const [y, m] = month.split("-").map(Number);
  const name = MONTHS[m - 1];
  const partial = from && from.slice(0, 7) === month && from.slice(8, 10) !== "01" ? ` from ${Number(from.slice(8, 10))} ${SHORT[m - 1]}` : "";
  if (month === today.slice(0, 7)) return partial ? `${name}${partial} to date` : `${name} to date`;
  return `${String(y) === today.slice(0, 4) ? name : `${name} ${y}`}${partial}`;
}

/**
 * The instant a firm-local date starts (its midnight in the firm's timezone), as ISO. Periods
 * start here, not at UTC midnight: "from 1 Oct" in Toronto starts at 04:00 UTC.
 */
export function localMidnightIso(date: string, timeZone: string): string {
  return new Date(localToUtc(date, "00:00", safeZone(timeZone))).toISOString();
}

// ---------- Processing and outcomes: see reports-outcomes.ts ----------

// ---------- Definitions shown on screen and in exports ----------

export const DEFINITIONS = {
  leads:
    "Definition: booked consultations that started in the period, up to now (confirmed, completed, no-show or cancelled; unpaid holds and expired holds are left out; upcoming ones are not counted yet). Matter opened: the booking is linked to a matter. Engaged: that matter’s engagement is recorded as engaged.",
  ageing:
    "Definition: matters not closed, by current stage. Days in stage count from the latest move into that stage (or from opening, if it never moved), to now.",
  workload:
    "Definition: open and blocked internal tasks each active staff member owns; overdue means a due date before today in the firm’s timezone. Matters: matters they are the responsible consultant for, plus matters of their open tasks.",
  documents:
    "Definition: open document requests. Expired: the request’s expiry date has passed. Otherwise by the latest upload’s review state: none yet, pending review, or rejected (changes requested).",
  attendance:
    "Definition: booked consultations that started in the period, up to now. Attended: marked completed. Rescheduled: moved at least once. No-show: marked no-show.",
  receivables:
    "Definition: issued and partly paid CAD invoices with an amount still owed (total less paid and credited), by days past the due date, as of today.",
  months:
    "Definition: only the days inside the period, in the firm’s timezone. Invoiced counts CAD invoices by issue date, not voided. Collected counts card payments that succeeded and approved transfers from client funds, by the day they settled. Refunds are not deducted.",
  balances:
    "Definition: per client, held is verified deposits less approved transfers and refunds in the client-account ledger. Pending is deposits waiting for verification. This is the firm’s bookkeeping, not a bank statement.",
  recon: "Definition: signed client-account reconciliations that recorded exceptions, plus reconciliations still waiting for review.",
  firm:
    "Firm work time is measured separately: days from opening the matter to the move to Submitted. It is the firm’s own preparation time, not government processing.",
} as const;

export function freshness(at: string, timezone: string, sources: string): string {
  return `Computed ${at} (${timezone}) from live records: ${sources}. Refresh the page for current figures.`;
}
