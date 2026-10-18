/**
 * Pure helpers for the Sheet's Automations page: the deadline-reminder rule as the database runs
 * it (app.schedule_deadline_reminders, the reminder.due mail event) and its reminder schedules.
 * Reminder days are an administrative product control, not a legal deadline (decision 2026-10-17).
 */
import type { AutomationRun, AutomationSetting, AutomationStep, AutomationsData, AutomationsTab } from "@/components/sheet/designer/automations";
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
};

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
  const what = run.kind === "immediate" ? "Immediate reminder, due within a day" : `Reminder ${run.offsetDays} day${run.offsetDays === 1 ? "" : "s"} before`;
  const title = run.reference ? { left: run.matterName, right: run.reference } : run.matterName;
  if (run.status === "sent") return { title, note: { left: what, right: "sent to the mail queue" }, state: { tone: "ok", label: "Sent" }, when: when(run.sentAt ?? run.scheduledFor, now, timeZone) };
  if (run.status === "cancelled") return { title, note: `Stopped: ${what.toLowerCase()}, the deadline changed or was removed`, state: { tone: "gr", label: "Stopped" }, when: when(run.createdAt, now, timeZone) };
  return { title, note: { left: what, right: `scheduled for ${dayMonth(isoDateInTimeZone(new Date(run.scheduledFor), timeZone))}` }, state: { tone: "rev", label: "Scheduled" }, when: when(run.createdAt, now, timeZone) };
}

export function automationsData(input: {
  tab: AutomationsTab;
  days: number[];
  firmSet: boolean;
  quiet: string | null;
  runs: readonly ReminderRun[];
  now: Date;
  timeZone: string;
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
  const settings: AutomationSetting[] = [
    { label: "Reminder days", value: input.days.length ? dayList(input.days) : "None" },
    { label: "Quiet hours", value: input.quiet ?? "None set", icon: "moon" },
    { label: "Delay", value: "None" },
    { label: "Critical exceptions", value: "Due within a day" },
  ];
  return {
    tab: input.tab,
    name: "Deadline reminders",
    pills: ["Active", lastSent?.sentAt ? `Last run ${when(lastSent.sentAt, input.now, input.timeZone)}` : "Not run yet"],
    actions: null,
    intro:
      "Automations create tasks, assign staff, request documents and send approved admin templates. Legal advice, refunds, bank details, outcomes and submissions always need a person. Reminder days are an office routine, not a legal deadline.",
    steps,
    addStep: false,
    runs: input.runs.map((run) => runRow(run, input.now, input.timeZone)),
    settings,
    others: [],
    vo: null,
  };
}
