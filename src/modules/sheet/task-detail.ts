/**
 * Pure helpers for the Task dialog's detail (OPS-01): watchers, depends on, checklist, estimate,
 * blocker, due time and timezone, repeat and history. The database decides every change; these
 * shape what it returns and word its refusals.
 */
import { safeAccessError } from "@/lib/auth/step-up";
import { dayMonth } from "@/modules/sheet/home-present";
import { isoDateInTimeZone } from "@/modules/sheet/present";

export type ChecklistItem = { text: string; done: boolean };
export type TaskRecurrence = "" | "weekly" | "monthly";
export type DetailOption = { value: string; label: string };

/** What the Task dialog shows for one task (src/modules/tasks/actions.ts loadTaskDetail). */
export type TaskDetail = {
  id: string;
  version: number;
  title: string;
  audience: "internal" | "client";
  status: string;
  /** False once done or cancelled: the dialog then only shows. */
  open: boolean;
  dueOn: string;
  /** "HH:MM" in the due timezone, or "". */
  dueTime: string;
  dueTimezone: string;
  estimate: number | null;
  recurrence: TaskRecurrence;
  watchers: { id: string; name: string }[];
  watcherOptions: DetailOption[];
  dependsOn: { id: string; title: string; done: boolean }[];
  dependsOnOptions: DetailOption[];
  checklist: ChecklistItem[];
  blocker: { note: string; recorded: string } | null;
  history: string[];
};

/** Canadian zones first; the firm's and the task's own are added when missing. */
export const TASK_ZONES: readonly string[] = [
  "America/St_Johns",
  "America/Halifax",
  "America/Toronto",
  "America/Winnipeg",
  "America/Regina",
  "America/Edmonton",
  "America/Vancouver",
  "America/Whitehorse",
  "UTC",
];

export function zoneOptions(...extra: (string | null | undefined)[]): string[] {
  const zones = [...TASK_ZONES];
  for (const zone of extra) if (zone && !zones.includes(zone)) zones.push(zone);
  return zones;
}

/** A stored checklist as items. Anything that isn't `{text}` is left out rather than guessed. */
export function readChecklist(raw: unknown): ChecklistItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const text = (item as { text?: unknown }).text;
    if (typeof text !== "string" || !text.trim()) return [];
    return [{ text: text.trim(), done: (item as { done?: unknown }).done === true }];
  });
}

/** "2/3 done", or "No items yet". */
export function checklistProgress(items: readonly ChecklistItem[]): string {
  if (items.length === 0) return "No items yet";
  return `${items.filter((item) => item.done).length}/${items.length} done`;
}

/** "Checklist 2/3" for a task row, or null with no items. */
export function checklistPart(raw: unknown): string | null {
  const items = readChecklist(raw);
  return items.length ? `Checklist ${items.filter((item) => item.done).length}/${items.length}` : null;
}

export function recurrenceOf(raw: string | null | undefined): TaskRecurrence {
  return raw === "weekly" || raw === "monthly" ? raw : "";
}

/** "Repeats weekly" for a task row, or null. */
export function recurrencePart(raw: string | null | undefined): string | null {
  const value = recurrenceOf(raw);
  return value ? `Repeats ${value}` : null;
}

/** "45 min", "1 h 30 min". */
export function estimateLabel(minutes: number | null | undefined): string | null {
  if (typeof minutes !== "number" || !Number.isFinite(minutes)) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** The due instant's clock time in its zone, "HH:MM". */
export function dueTimeIn(dueAt: string | null, timeZone: string): string {
  if (!dueAt) return "";
  const at = new Date(dueAt);
  if (Number.isNaN(at.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  } catch {
    return "";
  }
}

/** "23 Oct, 14:05" in the firm's zone. */
export function whenLabel(at: string, timeZone: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return `${dayMonth(isoDateInTimeZone(date, timeZone))}, ${dueTimeIn(at, timeZone)}`;
}

const STATUS_WORD: Record<string, string> = { open: "reopened it", blocked: "marked it blocked", done: "marked it done", cancelled: "cancelled it" };

/** One line of a task's history (public.task_events), newest first in the dialog. */
export function historyLine(
  event: { event_kind: string; to_status: string | null; to_membership_id: string | null; actor_user_id: string | null; created_at: string },
  name: { user: (id: string | null) => string; member: (id: string | null) => string },
  timeZone: string,
): string {
  const who = name.user(event.actor_user_id);
  const when = whenLabel(event.created_at, timeZone);
  switch (event.event_kind) {
    case "created":
      return `${who} created it · ${when}`;
    case "reassigned":
      return `${who} gave it to ${name.member(event.to_membership_id)} · ${when}`;
    case "escalated":
      return `${who} escalated it as overdue · ${when}`;
    case "status":
      return `${who} ${STATUS_WORD[event.to_status ?? ""] ?? "changed its status"} · ${when}`;
    case "intake_flagged":
      return `An intake answer it uses changed · ${when}`;
    default:
      return `Changed · ${when}`;
  }
}

/** "Recorded by Dana Lee, 23 Oct, 14:05": who blocked it and when (the latest status event to blocked). */
export function blockerRecorded(by: string, at: string | null, timeZone: string): string {
  return at ? `Recorded by ${by}, ${whenLabel(at, timeZone)}` : `Recorded by ${by}`;
}

/** The estimate field: whole minutes 0 to 100000, or null when empty. */
export function readEstimate(raw: string | null | undefined): { minutes: number | null } | { error: string } {
  const value = (raw ?? "").trim();
  if (!value) return { minutes: null };
  if (!/^\d{1,6}$/.test(value) || Number(value) > 100000) return { error: "The estimate is a number of minutes, up to 100000." };
  return { minutes: Number(value) };
}

/** The due time field: "HH:MM" or empty. */
export function readDueTime(raw: string | null | undefined): { time: string | null } | { error: string } {
  const value = (raw ?? "").trim();
  if (!value) return { time: null };
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? { time: value } : { error: "Enter the due time as HH:MM." };
}

/** A checklist item typed in the dialog. */
export function readChecklistText(raw: string | null | undefined): { text: string } | { error: string } {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text || text.length > 200) return { error: "Each checklist item needs a few words, up to 200 characters." };
  return { text };
}

/** User-facing copy for a refused detail change. Never passes a database message through. */
export function taskDetailError(message: string): string {
  if (/version conflict/i.test(message)) return "Someone changed this task since you opened it. Reload and try again.";
  if (/only an open task/i.test(message)) return "Only an open task can be edited.";
  if (/estimate/i.test(message)) return "The estimate is a number of minutes, up to 100000.";
  if (/repeats weekly or monthly/i.test(message)) return "A task repeats weekly or monthly.";
  if (/due time needs a due date/i.test(message)) return "Set a due date before a due time.";
  if (/timezone/i.test(message)) return "Choose a timezone from the list.";
  if (/checklist holds up to/i.test(message)) return "A checklist holds up to 50 items.";
  if (/checklist/i.test(message)) return "Each checklist item needs a few words, up to 200 characters.";
  if (/watcher must be active staff/i.test(message)) return "Choose an active staff member to watch it.";
  if (/cycle/i.test(message)) return "That would make the tasks wait on each other.";
  if (/dependency denied/i.test(message)) return "A task can only wait on another task on the same matter.";
  if (/blocker note/i.test(message)) return "Say what is blocking it.";
  if (/open dependency/i.test(message)) return "It waits on another task that is still open. Finish that one first.";
  if (/denied|staff access/i.test(message)) return "Your role can’t change this task.";
  return safeAccessError(message);
}
