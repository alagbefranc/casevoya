/**
 * REP-01: the firm-report metrics added to the Operations and Money tabs (overdue tasks, intake
 * completion, time to internal readiness, renewal workload) and the list each card links to.
 * Pure: every figure comes from rows the signed-in staff member could read (RLS decides), with
 * the same rule the list behind the card uses, so the card and the list agree. Nothing is
 * benchmarked, extrapolated or ranked; with no rows a card says so.
 */
import type { ReportBar, ReportLink, ReportsOpsMore } from "@/components/sheet/designer/reports";
import { MEDIAN_NOTE, daysBetween, median, medianLabel, percent } from "@/modules/sheet/reports-present";
import type { ReportSection } from "@/modules/sheet/reports-export";
import { isOverdue } from "@/modules/sheet/tasks-present";

/** The lists behind the cards. Filters are the lists' own (`f` picks a Tasks chip, `q` presets search). */
export const REPORT_LINKS = {
  leads: { href: "/sheet/consultations", label: "Open consultations" },
  ageing: { href: "/sheet/matters", label: "Open matters" },
  workload: { href: "/sheet/tasks", label: "Open tasks" },
  documents: { href: "/sheet/documents?tab=all&view=requests", label: "Open the requests" },
  attendance: { href: "/sheet/consultations", label: "Open consultations" },
  overdue: { href: "/sheet/tasks?f=overdue", label: "Open overdue tasks" },
  intake: { href: "/sheet/tasks?tab=client", label: "Open client tasks" },
  readiness: { href: "/sheet/matters?stage=ready_to_submit", label: "Open matters ready to submit" },
  renewals: { href: "/sheet/tasks?q=Renewal%20review", label: "Open renewal reviews" },
  receivables: { href: "/sheet/finance?tab=invoices", label: "Open invoices" },
  months: { href: "/sheet/finance?tab=invoices", label: "Open invoices" },
  balances: { href: "/sheet/finance?tab=funds", label: "Open client funds" },
} as const satisfies Record<string, ReportLink>;

/** The matters list filtered to one stage (stage ageing rows). */
export function stageHref(stage: string): string {
  return `/sheet/matters?stage=${encodeURIComponent(stage)}`;
}

// ---------- Overdue tasks ----------

export type OverdueTaskInput = { matterId: string | null; dueOn: string | null; dueAt: string | null; status: string };

/**
 * Open and blocked internal tasks past due, by the Tasks page's own rule (isOverdue: a due time
 * before now, otherwise a due date before today in the firm's timezone). Tasks on sample matters
 * are counted apart while sample mode is off, so the card can say how many the Tasks page shows
 * that the report leaves out.
 */
export function overdueTasks(tasks: OverdueTaskInput[], today: string, now: Date, sampleMatters: ReadonlySet<string> = new Set()) {
  let open = 0;
  let overdue = 0;
  // Open work on sample matters is on the Tasks page but not counted here: all of it, and how much is late.
  let sampleOpen = 0;
  let sample = 0;
  for (const task of tasks) {
    if (task.status !== "open" && task.status !== "blocked") continue;
    const onSample = Boolean(task.matterId && sampleMatters.has(task.matterId));
    const late = isOverdue(task.dueOn, task.dueAt, today, now);
    if (onSample) {
      sampleOpen++;
      if (late) sample++;
      continue;
    }
    open++;
    if (late) overdue++;
  }
  return { open, overdue, sampleOpen, sample };
}

export function overdueNote(result: { open: number; overdue: number; sampleOpen: number; sample: number }): string {
  const parts = [
    result.open
      ? `${result.overdue} of ${result.open} open internal ${result.open === 1 ? "task is" : "tasks are"} overdue.`
      : "No open internal tasks.",
  ];
  if (result.sampleOpen) {
    const late = result.sample ? ` (${result.sample} overdue)` : "";
    parts.push(
      `${result.sampleOpen} more open ${result.sampleOpen === 1 ? "task" : "tasks"} on sample matters ${result.sampleOpen === 1 ? "is" : "are"} on the Tasks page but not counted here${late}.`,
    );
  }
  return parts.join(" ");
}

// ---------- Outstanding documents (the requests list) ----------

export type RequestWaiting = "missing" | "review" | "changes" | "expired";

/** Where one open request waits, by the same rule as the report's Outstanding documents bars. */
export function requestWaiting(request: { status: string; expiresOn: string | null; reviewState: string | null; hasDocument: boolean }, today: string): RequestWaiting | null {
  if (request.status !== "open") return null;
  if (request.expiresOn && request.expiresOn < today) return "expired";
  if (!request.hasDocument || request.reviewState === null) return "missing";
  if (request.reviewState === "rejected") return "changes";
  if (request.reviewState === "pending") return "review";
  return "missing";
}

/** The label each request carries on the requests list: the report's own bar labels. */
export const WAITING_LABEL: Record<RequestWaiting, string> = {
  missing: "Requested, not uploaded",
  review: "Awaiting review",
  changes: "Changes requested",
  expired: "Expired",
};

const WAITING_TONE: Record<RequestWaiting, ReportBar["tone"]> = { missing: "w", review: "", changes: "w", expired: "g" };

/** The Outstanding documents bars from the requests list's own rows (same order and words as before). */
export function requestBars(requests: { waiting: RequestWaiting }[]): ReportBar[] {
  return (["missing", "review", "changes", "expired"] as RequestWaiting[]).map((key) => ({
    label: WAITING_LABEL[key],
    count: requests.filter((row) => row.waiting === key).length,
    tone: WAITING_TONE[key],
  }));
}

// ---------- Intake completion ----------

export type IntakeInput = { submitted: boolean; dueOn: string | null };

/** Intake forms sent in the period: completed (the client submitted), waiting, and waiting past the due date. */
export function intakeCompletion(requests: IntakeInput[], today: string): { bars: ReportBar[]; note: string } {
  const sent = requests.length;
  const completed = requests.filter((row) => row.submitted).length;
  const waiting = requests.filter((row) => !row.submitted);
  const late = waiting.filter((row) => row.dueOn !== null && row.dueOn < today).length;
  return {
    bars: [
      { label: "Sent", count: sent, tone: "" },
      { label: "Completed by the client", count: completed, tone: "" },
      { label: "Waiting for the client", count: waiting.length, tone: "w" },
      { label: "Waiting, past the due date", count: late, tone: "w" },
    ],
    note: sent
      ? `${completed} of ${sent} intake ${sent === 1 ? "form" : "forms"} sent in this period ${completed === 1 ? "is" : "are"} completed (${percent(completed, sent)}%).`
      : "No intake form was sent in this period.",
  };
}

// ---------- Time to internal readiness ----------

export type ReadinessInput = { createdAt: string; readyAt: string };

/**
 * Days from opening a matter to its first move into Ready to submit, for matters that first
 * reached it in the period. `notRecorded`: matters now past that stage with no recorded move into
 * it (opened before stage history, for example), which can't be measured and aren't counted.
 */
export function readiness(matters: ReadinessInput[], notRecorded: number): { matters: number; median: string; longest: string; note: string; recorded: boolean } {
  const days = matters.map((row) => daysBetween(row.createdAt, row.readyAt));
  const value = median(days);
  const missing = notRecorded
    ? ` ${notRecorded} ${notRecorded === 1 ? "matter is" : "matters are"} past Ready to submit with no recorded move into it, so ${notRecorded === 1 ? "it isn’t" : "they aren’t"} counted.`
    : "";
  if (!days.length) {
    return {
      matters: 0,
      median: "—",
      longest: "—",
      recorded: false,
      note: notRecorded
        ? `Not recorded: no matter reached Ready to submit in this period with a recorded stage move.${missing}`
        : "No matter reached Ready to submit in this period.",
    };
  }
  return {
    matters: days.length,
    median: medianLabel(value),
    longest: String(Math.max(...days)),
    recorded: true,
    note: `${days.length} ${days.length === 1 ? "matter" : "matters"} reached Ready to submit in this period.${missing}`,
  };
}

// ---------- Renewal workload ----------

export type RenewalInput = { expiresOn: string; remindOn: string; taskOpen: boolean; cancelled: boolean };

/** Recorded expiries whose renewal review task is still open, by how soon the status or document expires. */
export function renewalWorkload(renewals: RenewalInput[], today: string): { bars: ReportBar[]; note: string } {
  const open = renewals.filter((row) => !row.cancelled && row.taskOpen);
  const days = (row: RenewalInput) => (row.expiresOn < today ? -1 : daysBetween(today, row.expiresOn));
  const count = (test: (n: number) => boolean) => open.filter((row) => test(days(row))).length;
  const due = open.filter((row) => row.remindOn <= today).length;
  return {
    bars: [
      { label: "Already expired", count: count((n) => n < 0), tone: "g" },
      { label: "Expires within 30 days", count: count((n) => n >= 0 && n <= 30), tone: "w" },
      { label: "31–90 days", count: count((n) => n > 30 && n <= 90), tone: "" },
      { label: "91–180 days", count: count((n) => n > 90 && n <= 180), tone: "" },
      { label: "Later", count: count((n) => n > 180), tone: "" },
    ],
    note: open.length
      ? `${open.length} renewal ${open.length === 1 ? "review is" : "reviews are"} open; ${due} ${due === 1 ? "has" : "have"} reached ${due === 1 ? "its" : "their"} reminder date.`
      : "No open renewal reviews.",
  };
}

// ---------- Definitions ----------

export const MORE_DEFINITIONS = {
  overdue:
    "Definition: open and blocked internal tasks with a due time before now or, without one, a due date before today in the firm’s timezone. The same rule as the Overdue filter on the Tasks page. Tasks on sample matters are left out unless sample mode is on.",
  intake:
    "Definition: intake forms sent to a client in the period. Completed: the client submitted the form. Waiting: not submitted yet; past the due date when the request’s due date is before today.",
  readiness:
    `Definition: days from opening the matter to its first recorded move into Ready to submit, for matters that first reached it in the period. Matters with no recorded move into that stage can’t be measured and aren’t counted. ${MEDIAN_NOTE.replace("files", "matters")}`,
  renewals:
    "Definition: expiries recorded on an approved decision whose renewal review task is still open, by days until the recorded expiry date. Cancelled renewals are left out. Expiry dates are the ones the firm recorded from the decision document.",
} as const;

/** The added cards, as export sections (CSV and PDF keep the same figures and definitions). */
export type OpsMore = {
  overdue: { open: number; overdue: number; sampleOpen: number; sample: number; note: string; definition: string };
  intake: { bars: ReportBar[]; note: string; definition: string };
  readiness: { matters: number; median: string; longest: string; note: string; recorded: boolean; definition: string };
  renewals: { bars: ReportBar[]; note: string; definition: string };
};

export function opsMoreSections(more: ReportsOpsMore | null | undefined): ReportSection[] {
  if (!more) return [];
  return [
    { title: "Overdue tasks", head: ["Overdue", "Open internal tasks"], rows: [[String(more.overdue.overdue), String(more.overdue.open)]], note: more.overdue.note, definition: more.overdue.definition },
    { title: "Intake completion", head: ["Step", "Forms"], rows: more.intake.bars.map((bar) => [bar.label, String(bar.count)]), note: more.intake.note, definition: more.intake.definition },
    {
      title: "Time to internal readiness",
      head: ["Matters", "Median days", "Longest"],
      rows: more.readiness.recorded ? [[String(more.readiness.matters), more.readiness.median, more.readiness.longest]] : [],
      note: more.readiness.note,
      definition: more.readiness.definition,
    },
    { title: "Renewal workload", head: ["Expiry", "Open reviews"], rows: more.renewals.bars.map((bar) => [bar.label, String(bar.count)]), note: more.renewals.note, definition: more.renewals.definition },
  ];
}

