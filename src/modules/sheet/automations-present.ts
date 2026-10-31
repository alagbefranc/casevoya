/**
 * Pure helpers for the Sheet's Automations page: the deadline-reminder rule as the database runs
 * it (app.schedule_deadline_reminders, the reminder.due mail event) and its reminder schedules.
 * Reminder days are an administrative product control, not a legal deadline (decision 2026-10-17).
 */
import { AUTOMATION_DIALOG, type AutomationRun, type AutomationSetting, type AutomationStep, type AutomationsData, type AutomationsTab } from "@/components/sheet/designer/automations";
import { dayMonth } from "@/modules/sheet/home-present";
import { isoDateInTimeZone } from "@/modules/sheet/present";
import { DEADLINE_KINDS, type DeadlineKindKey, type FirmAutomationView } from "@/modules/sheet/automation-rules";

export { automationError, automationProblem, DEADLINE_KINDS, readReminderDays, type DeadlineKindKey, type FirmAutomationView } from "@/modules/sheet/automation-rules";

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
  /** The firm's own automations (public.firm_automations). */
  automations?: readonly FirmAutomationView[];
  /** The automation shown: one of `automations` by id; otherwise the built-in rule. */
  selectedId?: string | null;
  /** A firm owner or licensed consultant: New automation, Edit, Pause or Resume, Duplicate, Make a copy. */
  manage?: { organizationId: string } | null;
}): AutomationsData {
  const automations = input.automations ?? [];
  const selected = automations.find((rule) => rule.id === input.selectedId) ?? null;
  const others: AutomationsData["others"] = [
    { label: "Deadline reminders (built in)", on: true, href: "/sheet/automations", current: !selected },
    ...automations.map((rule) => ({ label: rule.name, on: rule.status === "active", href: `/sheet/automations?rule=${rule.id}`, current: rule.id === selected?.id })),
  ];
  const manage = input.manage
    ? { organizationId: input.manage.organizationId, selected, builtInDays: [...input.days], builtInName: "Deadline reminders" }
    : null;
  const runs = orderedRuns(input.runs).map((run) => ({ ...runRow(run, input.now, input.timeZone), ...(run.matterId ? { href: `/sheet/matters/${run.matterId}?tab=tasks` } : {}) }));
  if (selected) {
    return {
      tab: input.tab,
      name: selected.name,
      pills: [selected.status === "active" ? "Active" : "Paused", selected.copiedFromBuiltIn ? "Copy of the built-in rule" : "Your firm’s automation"],
      actions: null,
      intro: `Your firm’s automation. ${
        selected.status === "active" ? "Deadlines of these kinds saved from now on get these reminders, as well as the built-in rule’s." : "Paused: deadlines saved while it is paused get no reminders from it."
      } A day both rules use is one reminder, not two. ${input.manage ? "Edit it, pause it or duplicate it above." : "A firm owner or licensed consultant can change it."}`,
      steps: firmAutomationSteps(selected, input.quiet),
      addStep: false,
      runs,
      settings: [
        { label: "Reminder days", value: dayList(selected.days) },
        { label: "Deadlines", value: kindList(selected.kinds) },
        { label: "Sends", value: "Approved reminder email (fixed)" },
        { label: "To", value: "Clients on the matter who chose reminders (fixed)" },
        { label: "Quiet hours", value: input.quiet ?? "None set", icon: "moon" },
        { label: "Critical exceptions", value: "Due within a day (fixed)" },
      ],
      others,
      manage,
      vo: null,
    };
  }
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
    pills: ["Active", "Built in", lastSent?.sentAt ? `Last run ${when(lastSent.sentAt, input.now, input.timeZone)}` : "Not run yet"],
    actions: null,
    intro:
      `Automations create tasks, assign staff, request documents and send approved admin templates. Legal advice, refunds, bank details, outcomes and submissions always need a person. Reminder days are an office routine, not a legal deadline. This rule is built in and locked${input.manage ? ": use Make a copy to build your own version, or New automation" : ""}; ${
        input.editable ? "change its reminder days and quiet hours under Settings." : "the firm owner changes its reminder days and quiet hours under Settings."
      }`,
    steps,
    addStep: false,
    runs,
    settings,
    others,
    manage,
    vo: null,
  };
}



export function readFirmAutomation(row: {
  id: string;
  name: string;
  status: string;
  deadline_kinds: string[] | null;
  offset_days: number[] | null;
  version: number;
  copied_from: string | null;
}): FirmAutomationView {
  const known = new Set<string>(DEADLINE_KINDS.map((kind) => kind.key));
  return {
    id: row.id,
    name: row.name,
    status: row.status === "paused" ? "paused" : "active",
    kinds: (row.deadline_kinds ?? []).filter((kind): kind is DeadlineKindKey => known.has(kind)),
    days: [...(row.offset_days ?? [])].sort((a, b) => b - a),
    version: row.version,
    copiedFromBuiltIn: row.copied_from === "builtin_deadline_reminders",
  };
}

/** "legal deadlines and IRCC and other letters": the covered kinds, for a sentence. */
export function kindList(kinds: readonly string[]): string {
  const labels = DEADLINE_KINDS.filter((kind) => kinds.includes(kind.key)).map((kind) => (/^[A-Z][a-z]/.test(kind.label) ? kind.label.charAt(0).toLowerCase() + kind.label.slice(1) : kind.label));
  if (labels.length === DEADLINE_KINDS.length) return "any kind of deadline";
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}



/** The When / If / Then / Stop steps of one of the firm's automations. */
export function firmAutomationSteps(rule: FirmAutomationView, quiet: string | null): AutomationStep[] {
  const steps: AutomationStep[] = [
    { icon: "bell", title: "When", text: "A deadline with a due date is saved on a matter", badge: { label: "Event" } },
    {
      icon: "filter",
      title: "If",
      text: { left: `It is one of: ${kindList(rule.kinds)}`, right: "and the reminder day is still ahead" },
      badge: { label: "Conditions" },
    },
    {
      icon: "clock",
      title: "Then",
      text: { left: `Email client reminders ${dayList(rule.days)} days before`, right: "the approved reminder email; staff see it in Notifications" },
      badge: { label: "Action" },
    },
  ];
  if (quiet) steps.push({ icon: "moon", title: "And", text: `Routine reminders move out of quiet hours (${quiet})`, badge: { label: "Action" } });
  steps.push({ icon: "x-circle", title: "Stop when", text: "The deadline changes or is removed, or the automation is paused before the deadline is saved", badge: { label: "Stop rule" } });
  return steps;
}
