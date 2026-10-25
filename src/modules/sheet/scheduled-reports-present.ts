/**
 * Reports > Scheduled (REP-03), pure. Shapes public.scheduled_reports_overview for the Designer's
 * Scheduled table and the schedule dialog, and turns database refusals into plain words. Every
 * schedule sends a link only ("Link only"): the report is never attached or put in a message.
 */
import type { ReportRange, ReportsTab } from "@/components/sheet/designer/reports";

export type ScheduleTab = Exclude<ReportsTab, "scheduled">;
export type ScheduleFrequency = "weekly" | "monthly";

export const SCHEDULE_TABS: readonly ScheduleTab[] = ["ops", "money", "outcomes"];
export const TAB_LABEL: Record<ScheduleTab, string> = { ops: "Operations", money: "Money", outcomes: "Processing and outcomes" };
export const PERIOD_LABEL: Record<ReportRange, string> = { "90d": "Last 90 days", month: "This month", year: "This year" };
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const MAX_RECIPIENTS = 20;

export type ScheduleRecord = {
  id: string;
  title: string;
  tab: ScheduleTab;
  range: ReportRange;
  frequency: ScheduleFrequency;
  weekday: number | null;
  monthDay: number | null;
  sendTime: string;
  paused: boolean;
  nextRunAt: string | null;
  version: number;
  canEdit: boolean;
  createdByName: string | null;
  recipients: { userId: string; name: string; canSee: boolean }[];
  lastRun: { at: string; kind: "scheduled" | "test"; delivered: number; skipped: number } | null;
};

export type ScheduleStaff = { userId: string; name: string; tabs: ScheduleTab[] };

export type ScheduleOverview = { timezone: string; me: string | null; tabs: ScheduleTab[]; staff: ScheduleStaff[]; schedules: ScheduleRecord[] };

const isTab = (value: unknown): value is ScheduleTab => typeof value === "string" && (SCHEDULE_TABS as readonly string[]).includes(value);
const isRange = (value: unknown): value is ReportRange => value === "90d" || value === "month" || value === "year";
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const int = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isInteger(n) ? n : null;
};
const obj = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

/** Only well-formed rows from the database; anything else is dropped rather than guessed. */
export function readScheduleOverview(raw: unknown): ScheduleOverview {
  const row = obj(raw) ?? {};
  const tabs = Array.isArray(row.tabs) ? row.tabs.filter(isTab) : [];
  const staff: ScheduleStaff[] = (Array.isArray(row.staff) ? row.staff : []).flatMap((item) => {
    const person = obj(item);
    const userId = str(person?.user_id);
    if (!person || !userId) return [];
    return [{ userId, name: str(person.name)?.trim() || "Staff member", tabs: Array.isArray(person.tabs) ? person.tabs.filter(isTab) : [] }];
  });
  const schedules: ScheduleRecord[] = (Array.isArray(row.schedules) ? row.schedules : []).flatMap((item) => {
    const s = obj(item);
    if (!s) return [];
    const id = str(s.id);
    const frequency = s.frequency === "weekly" || s.frequency === "monthly" ? s.frequency : null;
    if (!id || !isTab(s.tab) || !isRange(s.range) || !frequency) return [];
    const last = obj(s.last_run);
    const lastAt = str(last?.at);
    return [
      {
        id,
        title: str(s.title)?.trim() || "Scheduled report",
        tab: s.tab,
        range: s.range,
        frequency,
        weekday: int(s.weekday),
        monthDay: int(s.month_day),
        sendTime: /^\d{2}:\d{2}$/.test(str(s.send_time) ?? "") ? (s.send_time as string) : "08:00",
        paused: s.paused === true,
        nextRunAt: str(s.next_run_at),
        version: int(s.version) ?? 1,
        canEdit: s.can_edit === true,
        createdByName: str(s.created_by_name),
        recipients: (Array.isArray(s.recipients) ? s.recipients : []).flatMap((r) => {
          const rec = obj(r);
          const userId = str(rec?.user_id);
          return rec && userId ? [{ userId, name: str(rec.name)?.trim() || "Staff member", canSee: rec.can_see === true }] : [];
        }),
        lastRun:
          last && lastAt
            ? { at: lastAt, kind: last.kind === "test" ? "test" : "scheduled", delivered: int(last.delivered) ?? 0, skipped: int(last.skipped) ?? 0 }
            : null,
      },
    ];
  });
  return { timezone: str(row.timezone) || "America/Toronto", me: str(row.me), tabs, staff, schedules };
}

/** "19 Oct 08:00" on the firm's clock, the Designer's form for the Next column. */
export function scheduleMoment(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${Number(get("day"))} ${MONTHS[Number(get("month")) - 1] ?? ""} ${get("hour")}:${get("minute")}`;
}

function ordinal(n: number): string {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${tail}`;
}

/** "Week, Mondays 08:00" / "Month, the 1st 07:00". */
export function everyLabel(record: Pick<ScheduleRecord, "frequency" | "weekday" | "monthDay" | "sendTime">): string {
  if (record.frequency === "weekly") {
    const day = WEEKDAYS[(record.weekday ?? 1) - 1] ?? "Monday";
    return `Week, ${day}s ${record.sendTime}`;
  }
  return `Month, the ${ordinal(record.monthDay ?? 1)} ${record.sendTime}`;
}

export function recipientsLabel(recipients: ScheduleRecord["recipients"]): string {
  if (!recipients.length) return "No one";
  return recipients.map((person) => (person.canSee ? person.name : `${person.name} (no access now, skipped)`)).join(", ");
}

/** The last send, in plain words, counts only. */
export function lastRunLabel(record: ScheduleRecord, timeZone: string): string | null {
  const run = record.lastRun;
  if (!run) return null;
  const when = scheduleMoment(run.at, timeZone);
  const what = run.kind === "test" ? "Test sent" : "Sent";
  const people = `${run.delivered} ${run.delivered === 1 ? "person" : "people"}`;
  const skipped = run.skipped ? `; ${run.skipped} skipped because they can no longer see this report` : "";
  return `${record.title}: ${what} ${when} to ${people}${skipped}.`;
}

/** What the edit button carries into the dialog. */
export type ScheduleFormValue = {
  id: string;
  version: number;
  title: string;
  tab: ScheduleTab;
  range: ReportRange;
  frequency: ScheduleFrequency;
  weekday: number;
  monthDay: number;
  sendTime: string;
  recipients: string[];
};

export function scheduleFormValue(record: ScheduleRecord): ScheduleFormValue {
  return {
    id: record.id,
    version: record.version,
    title: record.title,
    tab: record.tab,
    range: record.range,
    frequency: record.frequency,
    weekday: record.weekday ?? 1,
    monthDay: record.monthDay ?? 1,
    sendTime: record.sendTime,
    recipients: record.recipients.map((person) => person.userId),
  };
}

export type ScheduledRowLive = {
  id: string;
  paused: boolean;
  canEdit: boolean;
  /** JSON of ScheduleFormValue for the edit dialog. */
  form: string;
};

export type ScheduledDesignerRow = { report: string; every: string; recipients: string; format: string; next: string; live?: ScheduledRowLive | null };

export type ScheduleDialogData = {
  organizationId: string;
  timezone: string;
  tabs: { value: ScheduleTab; label: string }[];
  staff: ScheduleStaff[];
};

export type ScheduledLive = {
  organizationId: string;
  canCreate: boolean;
  /** The signed-in person, ticked as a recipient in a new schedule. */
  selfUserId: string | null;
  runs: string[];
  note: string;
  error: string | null;
};

export const LINK_ONLY_NOTE =
  "Each send puts a link to the report in the recipients’ Casevoya notifications. The link needs them to sign in and shows what their role allows that day. No report, file or figures go in a message. Email for scheduled reports waits for an approved email design.";

export function scheduledRows(overview: ScheduleOverview): ScheduledDesignerRow[] {
  return overview.schedules.map((record) => ({
    report: `${record.title} (${TAB_LABEL[record.tab]}, ${PERIOD_LABEL[record.range].toLowerCase()})`,
    every: everyLabel(record),
    recipients: recipientsLabel(record.recipients),
    format: "Link only",
    next: record.paused ? "Paused" : scheduleMoment(record.nextRunAt, overview.timezone) || "Not set",
    live: { id: record.id, paused: record.paused, canEdit: record.canEdit, form: JSON.stringify(scheduleFormValue(record)) },
  }));
}

export function scheduledLive(organizationId: string, overview: ScheduleOverview): ScheduledLive {
  return {
    organizationId,
    canCreate: overview.tabs.length > 0,
    selfUserId: overview.me,
    runs: overview.schedules.map((record) => lastRunLabel(record, overview.timezone)).filter((line): line is string => Boolean(line)),
    note: LINK_ONLY_NOTE,
    error: null,
  };
}

/** The overview couldn't be read: say so, never show it as an empty list. */
export function scheduledUnavailable(organizationId: string): ScheduledLive {
  return {
    organizationId,
    canCreate: false,
    selfUserId: null,
    runs: [],
    note: LINK_ONLY_NOTE,
    error: "Scheduled reports couldn’t be read just now. Reload the page to try again.",
  };
}

export function scheduleDialog(organizationId: string, overview: ScheduleOverview): ScheduleDialogData {
  return {
    organizationId,
    timezone: overview.timezone,
    tabs: overview.tabs.map((tab) => ({ value: tab, label: TAB_LABEL[tab] })),
    staff: overview.staff,
  };
}

/** Client-side checks before the database, which decides. */
export function scheduleInputError(input: {
  title: string;
  tab: string;
  range: string;
  frequency: string;
  weekday: number | null;
  monthDay: number | null;
  sendTime: string;
  recipients: string[];
}): string | null {
  const title = input.title.trim();
  if (title.length < 2 || title.length > 120) return "Give the schedule a name (2 to 120 characters).";
  if (!isTab(input.tab)) return "Choose a report.";
  if (!isRange(input.range)) return "Choose a period.";
  if (input.frequency === "weekly") {
    if (!input.weekday || input.weekday < 1 || input.weekday > 7) return "Choose a weekday.";
  } else if (input.frequency === "monthly") {
    if (!input.monthDay || input.monthDay < 1 || input.monthDay > 28) return "Choose a day of the month from 1 to 28.";
  } else {
    return "Choose weekly or monthly.";
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.sendTime)) return "Choose a time.";
  const people = new Set(input.recipients.filter(Boolean));
  if (people.size < 1) return "Choose at least one recipient.";
  if (people.size > MAX_RECIPIENTS) return `Choose up to ${MAX_RECIPIENTS} recipients.`;
  return null;
}

/** A database refusal in plain words, or null to fall back to the generic message. */
export function scheduleError(message: string): string | null {
  if (/your role cannot see this report/i.test(message)) return "Your role can’t see this report, so you can’t schedule it.";
  if (/recipient cannot see this report/i.test(message)) return "Someone you chose can’t see this report. Only staff whose role sees it can receive it.";
  if (/choose from 1 to 20 recipients/i.test(message)) return `Choose from 1 to ${MAX_RECIPIENTS} recipients.`;
  if (/only who made it or the firm owner/i.test(message)) return "Only the person who made this schedule, or the firm owner, can change it.";
  if (/version conflict/i.test(message)) return "Someone changed this schedule first. Reload and try again.";
  if (/a test was just sent/i.test(message)) return "A test was just sent. Try again in a minute.";
  if (/scheduled report not found/i.test(message)) return "This schedule was deleted or moved. Reload the page.";
  if (/choose a weekday/i.test(message)) return "Choose a weekday.";
  if (/day of the month/i.test(message)) return "Choose a day of the month from 1 to 28.";
  if (/name the scheduled report/i.test(message)) return "Give the schedule a name (2 to 120 characters).";
  if (/scheduled reports denied/i.test(message)) return "You can’t manage scheduled reports here. Check you’re signed in to this firm.";
  return null;
}
