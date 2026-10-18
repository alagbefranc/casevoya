/** Pure helpers that turn firm records into the Designer home's words. Dates use the firm's timezone. */

export type LocalNow = { year: number; month: number; day: number; hour: number; weekday: string; monthName: string };

/** The current date and hour as seen in `timeZone`. */
export function localNow(timeZone: string, now: Date = new Date()): LocalNow {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
    weekday: "long",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const month = Number(get("month"));
  return {
    year: Number(get("year")),
    month,
    day: Number(get("day")),
    hour: Number(get("hour")),
    weekday: get("weekday"),
    monthName: MONTHS[month - 1],
  };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTHS = MONTHS.map((name) => name.slice(0, 3));
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** `YYYY-MM-DD` for a local date. */
export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function greeting(hour: number, name: string): string {
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const first = name.trim().split(/\s+/)[0];
  return first ? `Good ${part}, ${first}.` : `Good ${part}.`;
}

/** The city part of an IANA zone, the way the Designer writes "Toronto". */
export function zoneCity(timeZone: string): string {
  const last = timeZone.split("/").pop() ?? timeZone;
  return last.replace(/_/g, " ");
}

/** "30 Oct" from a `YYYY-MM-DD` date. */
export function dayMonth(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${day} ${SHORT_MONTHS[month - 1]}`;
}

/** "Tue 20" from a `YYYY-MM-DD` date. Dates are calendar dates, so UTC noon avoids any shift. */
export function weekdayDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return `${SHORT_DAYS[weekday]} ${day}`;
}

export type MonthGrid = { month: string; leading: number; days: { day: number; today?: boolean; marked?: boolean }[] };

/** Monday-first month grid. `marked` days carry a deadline or appointment. */
export function monthGrid(year: number, month: number, today: number | null, marked: Set<number>): MonthGrid {
  const first = new Date(Date.UTC(year, month - 1, 1, 12)).getUTCDay();
  const leading = (first + 6) % 7;
  const length = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  return {
    month: `${MONTHS[month - 1]} ${year}`,
    leading,
    days: Array.from({ length }, (_, index) => {
      const day = index + 1;
      const cell: { day: number; today?: boolean; marked?: boolean } = { day };
      if (day === today) cell.today = true;
      if (marked.has(day)) cell.marked = true;
      return cell;
    }),
  };
}

/** "8 min", "1 h", "3 d" — the Designer's short relative times. */
export function ago(iso: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

export type TaskBadge = { tone: "rev" | "chg" | "bad" | "gr" | "ok" | "blue"; label: string };

/** Status chip for an open task, from its state and due date relative to the firm's today. */
export function taskBadge(status: string, dueOn: string | null, today: string): TaskBadge {
  if (status === "blocked") return { tone: "chg", label: "Blocked" };
  if (!dueOn) return { tone: "gr", label: "No due date" };
  if (dueOn < today) return { tone: "bad", label: "Overdue" };
  if (dueOn === today) return { tone: "bad", label: "Today" };
  return { tone: "gr", label: weekdayDay(dueOn) };
}

function count(n: number, one: string, many: string) {
  return `${n === 0 ? "No" : n === 1 ? "One" : n} ${n === 1 ? one : many}`;
}

/** The sentence under the greeting. Only states what the records show. */
export function summary(now: LocalNow, city: string, documentsToReview: number, deadlinesToConfirm: number): string {
  const date = `${now.weekday} ${now.day} ${now.monthName}, ${city}.`;
  if (documentsToReview === 0 && deadlinesToConfirm === 0) return `${date} Nothing is waiting for your review.`;
  const parts: string[] = [];
  if (documentsToReview > 0) parts.push(`${count(documentsToReview, "document is", "documents are")} waiting for review`);
  if (deadlinesToConfirm > 0) parts.push(`${count(deadlinesToConfirm, "deadline needs", "deadlines need")} confirming`);
  const joined = parts.map((part, index) => (index === 0 ? part : part.charAt(0).toLowerCase() + part.slice(1)));
  return `${date} ${joined.join(", and ")}.`;
}

/**
 * What a firm activity looks like in the Designer's notification list, keyed by the audit action
 * the database writes. Other actions are not shown. tests/audit-actions.test.ts checks every key.
 */
export const NOTICE: Record<string, string> = {
  "document.uploaded": "Document uploaded",
  "document.upload_completed": "Document uploaded",
  "document.reviewed": "Document reviewed",
  "document.request_created": "Document requested",
  "agreement.sent": "Agreement sent for signature",
  "agreement.signed": "Agreement signed",
  "agreement.executed": "Agreement fully signed",
  "agreement.completed": "Agreement fully signed",
  "agreement.quote_accepted": "Quote accepted",
  "email.received": "Email received",
  "email.failed": "Email could not be delivered",
  "invitation.accepted": "Invitation accepted",
  "intake.submitted": "Questionnaire submitted",
  "matter.create": "Matter opened",
  "matter.stage_transition": "Matter stage changed",
  "matter.stage_override": "Matter stage changed",
  "matter.on_hold_set": "Matter put on hold",
  "matter.on_hold_cleared": "Matter resumed",
  "matter.government_status_recorded": "Government status recorded",
  "matter.outcome_recorded": "Outcome recorded",
  "firm.sample_case_created": "Sample case created",
  "task.overdue": "Task overdue",
  "deadline.confirmed": "Deadline confirmed",
};
