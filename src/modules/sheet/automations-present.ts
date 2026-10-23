/**
 * Pure helpers for the Sheet's Automations page: the deadline-reminder rule as the database runs
 * it (app.schedule_deadline_reminders, the reminder.due mail event) and its reminder schedules.
 * Reminder days are an administrative product control, not a legal deadline (decision 2026-10-17).
 */
import { AUTOMATION_DIALOG, type AutomationRun, type AutomationSetting, type AutomationStep, type AutomationsData, type AutomationsTab } from "@/components/sheet/designer/automations";
import { dayMonth } from "@/modules/sheet/home-present";
import { isoDateInTimeZone } from "@/modules/sheet/present";

export type ReminderRun = {
  status: string;
  kind: string;
  offsetDays: number | null;
  scheduledFor: string;
  sentAt: string | null;
  createdAt: string;
  matterName: string;
  reference: string | null;
  /** The deadline the reminder belongs to (its label and due day), when it is a deadline reminder. */
  deadline?: { label: string; dueOn: string | null } | null;
  matterId?: string | null;
};

/** "14, 7, 3, 1" (or "14 7 3 1") → [14, 7, 3, 1]; an error for anything else. Matches app.set_firm_reminder_offsets. */
export function readReminderDays(raw: string): { days: number[] } | { error: string } {
  const parts = raw.split(/[\s,;]+/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return { error: "Enter at least one reminder day, like 14, 7, 3, 1." };
  const days: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return { error: "Reminder days are whole numbers of days, like 14, 7, 3, 1." };
    const day = Number(part);
    if (day < 1 || day > 365) return { error: "Each reminder day is between 1 and 365 days before." };
    if (!days.includes(day)) days.push(day);
  }
  if (days.length > 12) return { error: "Choose at most 12 reminder days." };
  return { days: days.sort((a, b) => b - a) };
}

/** "21:00" and "08:00" → both; both empty → none (off); one alone → an error. */
export function readQuietHours(start: string, end: string): { start: string | null; end: string | null } | { error: string } {
  const a = start.trim();
  const b = end.trim();
  if (!a && !b) return { start: null, end: null };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(a) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b)) return { error: "Enter quiet hours as two times, like 21:00 and 08:00, or leave both empty." };
  if (a === b) return { error: "Quiet hours need different start and end times." };
  return { start: a, end: b };
}

/** "14, 7, 3 and 1". */
export function dayList(days: readonly number[]): string {
  const sorted = [...days].sort((a, b) => b - a).map(String);
  if (sorted.length <= 1) return sorted.join("");
  return `${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`;
}

/** The firm's own reminder days, else the proposed product days (`{"days":[14,7,3,1]}`). */
export function reminderDays(firm: readonly number[], proposed: unknown): { days: number[]; firmSet: boolean } {
  if (firm.length) return { days: [...firm].sort((a, b) => b - a), firmSet: true };
  const raw = (proposed as { days?: unknown } | null)?.days;
  const days = Array.isArray(raw) ? raw.map(Number).filter((day) => Number.isInteger(day) && day > 0) : [];
  return { days: days.sort((a, b) => b - a), firmSet: false };
}

/** "21:00–08:00" from two `HH:MM[:SS]` times, or null. */
export function quietHours(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  return `${start.slice(0, 5)}–${end.slice(0, 5)}`;
}

function when(iso: string, now: Date, timeZone: string): string {
  const date = isoDateInTimeZone(new Date(iso), timeZone);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  const today = isoDateInTimeZone(now, timeZone);
  return date === today ? time : `${dayMonth(date)} ${time}`;
}

export function runRow(run: ReminderRun, now: Date, timeZone: string): AutomationRun {
  const before = run.kind === "immediate" ? "Immediate reminder, due within a day" : `Reminder ${run.offsetDays} day${run.offsetDays === 1 ? "" : "s"} before`;
  // Say which deadline the reminder is for: "Medical exam, due 4 Nov · Reminder 7 days before".
  const deadline = run.deadline ? `${run.deadline.label}${run.deadline.dueOn ? `, due ${dayMonth(run.deadline.dueOn)}` : ""}` : null;
  const what = deadline ? `${deadline}: ${before.charAt(0).toLowerCase()}${before.slice(1)}` : before;
  const title = run.reference ? { left: run.matterName, right: run.reference } : run.matterName;
  if (run.status === "sent") return { title, note: { left: what, right: "sent to the mail queue" }, state: { tone: "ok", label: "Sent" }, when: when(run.sentAt ?? run.scheduledFor, now, timeZone) };
  if (run.status === "cancelled") return { title, note: `Stopped: ${deadline ? what : what.toLowerCase()}, the deadline changed, was removed, or had already passed`, state: { tone: "gr", label: "Stopped" }, when: when(run.createdAt, now, timeZone) };
  return { title, note: { left: what, right: `scheduled for ${dayMonth(isoDateInTimeZone(new Date(run.scheduledFor), timeZone))}` }, state: { tone: "rev", label: "Scheduled" }, when: when(run.createdAt, now, timeZone) };
}

/** When a run happened (or will): sent time, else the scheduled time, else when it was made. */
function runTime(run: ReminderRun): string {
  return run.status === "sent" ? (run.sentAt ?? run.scheduledFor) : run.status === "cancelled" ? run.createdAt : run.scheduledFor;
}

/** Newest first by when each reminder went out (or is due), so the list reads in time order. */
export function orderedRuns(runs: readonly ReminderRun[]): ReminderRun[] {
  return [...runs].sort((a, b) => runTime(b).localeCompare(runTime(a)));
}

export function automationsData(input: {
  tab: AutomationsTab;
  days: number[];
  firmSet: boolean;
  quiet: string | null;
  runs: readonly ReminderRun[];
  now: Date;
  timeZone: string;
  /** The firm owner may change the reminder days and quiet hours (#dlgAuto). */
  editable?: boolean;
}): AutomationsData {
  const lastSent = input.runs.filter((run) => run.sentAt).sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""))[0];
  const steps: AutomationStep[] = [
    { icon: "bell", title: "When", text: "A deadline with a due date is saved on a matter", badge: { label: "Event" } },
    { icon: "filter", title: "If", text: { left: "The reminder day is still ahead", right: "a deadline due within a day gets one reminder now" }, badge: { label: "Conditions" } },
    {
      icon: "clock",
      title: "Then",
      text: input.days.length ? `Email client reminders ${dayList(input.days)} days before${input.firmSet ? "" : " (proposed days)"}` : "No reminder days are set",
      badge: { label: "Action" },
    },
  ];
  if (input.quiet) steps.push({ icon: "moon", title: "And", text: `Routine reminders move out of quiet hours (${input.quiet})`, badge: { label: "Action" } });
  steps.push({ icon: "x-circle", title: "Stop when", text: "The deadline changes or is removed: pending reminders are cancelled and rescheduled", badge: { label: "Stop rule" } });
  // Reminder days and quiet hours are the firm's own settings: the firm owner changes them here
  // (#dlgAuto). Delay and the critical exception are fixed rules of the reminder job.
  const edit = input.editable ? { "data-dlg": AUTOMATION_DIALOG, title: "Change reminder days and quiet hours" } : undefined;
  const settings: AutomationSetting[] = [
    { label: "Reminder days", value: input.days.length ? `${dayList(input.days)}${input.firmSet ? "" : " (proposed)"}` : "None", attrs: edit },
    { label: "Quiet hours", value: input.quiet ?? "None set", icon: "moon", attrs: edit },
    { label: "Delay", value: "None (fixed)" },
    { label: "Critical exceptions", value: "Due within a day (fixed)" },
  ];
  return {
    tab: input.tab,
    name: "Deadline reminders",
    pills: ["Active", lastSent?.sentAt ? `Last run ${when(lastSent.sentAt, input.now, input.timeZone)}` : "Not run yet"],
    actions: null,
    intro:
      `Automations create tasks, assign staff, request documents and send approved admin templates. Legal advice, refunds, bank details, outcomes and submissions always need a person. Reminder days are an office routine, not a legal deadline. This rule’s steps are built in and can’t be edited; ${
        input.editable ? "change its reminder days and quiet hours under Settings." : "the firm owner changes its reminder days and quiet hours under Settings."
      }`,
    steps,
    addStep: false,
    runs: orderedRuns(input.runs).map((run) => ({ ...runRow(run, input.now, input.timeZone), ...(run.matterId ? { href: `/sheet/matters/${run.matterId}?tab=tasks` } : {}) })),
    settings,
    others: [],
    vo: null,
  };
}
