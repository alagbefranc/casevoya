/** Pure helpers that turn task and deadline records into the Designer Tasks page's words. */
import type { TaskChip, TasksTab } from "@/components/sheet/designer/tasks";
import { dayMonth, weekdayDay } from "@/modules/sheet/home-present";
import { isoDateInTimeZone } from "@/modules/sheet/present";

/** Rows read per tab. A firm's open work is read whole so the filter chips see every row. */
export const TASKS_READ = 500;

export function tasksTab(raw: string | undefined): TasksTab {
  return raw === "client" || raw === "deadlines" ? raw : "internal";
}

const PRIORITY: Record<string, TaskChip> = {
  critical: { tone: "bad", label: "Critical" },
  high: { tone: "chg", label: "High" },
  normal: { tone: "gr", label: "Normal" },
  low: { tone: "gr", label: "Low" },
};

export function priorityChip(priority: string): TaskChip {
  return PRIORITY[priority] ?? PRIORITY.normal;
}

/** An internal task's state: a chip when it needs attention, plain words otherwise. */
export function internalState(status: string, escalatedAt: string | null): TaskChip | string {
  if (status === "blocked") return { tone: "gr", label: "Blocked" };
  if (status === "done") return { tone: "ok", label: "Done" };
  if (status === "cancelled") return "Cancelled";
  if (escalatedAt) return { tone: "bad", label: "Escalated" };
  return "Open";
}

/** A client task's state as the Designer names it. Portal views are not tracked, so there is no "Opened". */
export function clientState(status: string): TaskChip {
  if (status === "done") return { tone: "ok", label: "Done" };
  if (status === "blocked") return { tone: "chg", label: "Blocked" };
  if (status === "cancelled") return { tone: "gr", label: "Cancelled" };
  return { tone: "rev", label: "Requested" };
}

export function deadlineState(verification: string): TaskChip {
  return verification === "confirmed" ? { tone: "ok", label: "Verified" } : { tone: "chg", label: "Tentative, confirm" };
}

/** "ET", "PT", "UTC": the short zone name the Designer writes after a time. */
export function zoneAbbr(timeZone: string, at: Date = new Date()): string {
  if (/^(Etc\/)?(UTC|GMT|Zulu)$/i.test(timeZone)) return "UTC";
  const name = (style: "shortGeneric" | "short") => {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: style }).formatToParts(at).find((part) => part.type === "timeZoneName")?.value ?? "";
    } catch {
      return "";
    }
  };
  const generic = name("shortGeneric");
  if (/^[A-Z]{2,5}$/.test(generic)) return generic;
  return name("short") || timeZone;
}

/** "Mon 19 Oct" from a `YYYY-MM-DD` date ("Mon 18 Oct 2027" in another year), or "Today". */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  return `${weekdayDay(date)} ${dayMonth(date).split(" ")[1]}${date.slice(0, 4) !== today.slice(0, 4) ? ` ${date.slice(0, 4)}` : ""}`;
}

function clock(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

/**
 * When something is due, in `timeZone`: "Today 12:00 ET", "Mon 19 Oct", or "—".
 * A date-only due date is a calendar date and is shown as it is stored.
 */
export function dueLabel(dueOn: string | null, dueAt: string | null, timeZone: string, today: string): string {
  if (dueAt) {
    const at = new Date(dueAt);
    if (!Number.isNaN(at.getTime())) {
      return `${dayLabel(isoDateInTimeZone(at, timeZone), today)} ${clock(at, timeZone)} ${zoneAbbr(timeZone, at)}`;
    }
  }
  return dueOn ? dayLabel(dueOn, today) : "—";
}

/**
 * The Tasks page's Due cell (OPS-01 "due timezone shown"): a timed due shows its own zone
 * ("Mon 19 Oct 09:30 PT"); a date-only due in another zone than the firm's says which
 * ("Mon 19 Oct (PT)").
 */
export function dueInZone(dueOn: string | null, dueAt: string | null, dueZone: string, firmZone: string, today: string): string {
  const label = dueLabel(dueOn, dueAt, dueZone, today);
  if (dueAt || !dueOn || dueZone === firmZone) return label;
  return `${label} (${zoneAbbr(dueZone, new Date(`${dueOn}T12:00:00Z`))})`;
}

/** Whether open work is past due, as seen on the firm's calendar (date) or clock (instant). */
export function isOverdue(dueOn: string | null, dueAt: string | null, today: string, now: Date): boolean {
  if (dueAt) {
    const at = new Date(dueAt);
    if (!Number.isNaN(at.getTime())) return at.getTime() < now.getTime();
  }
  return Boolean(dueOn && dueOn < today);
}

/** "Police certificate accepted", "Amara approved ✓", or "—". A finished dependency carries a tick. */
export function dependsOnLabel(dependencies: { title: string; done: boolean }[]): string {
  if (dependencies.length === 0) return "—";
  return dependencies.map((item) => (item.done ? `${item.title} ✓` : item.title)).join(", ");
}

/** Distinct reminder offsets, largest first. */
export function reminderOffsets(offsets: (number | null)[]): number[] {
  return [...new Set(offsets.filter((value): value is number => typeof value === "number" && value > 0))].sort((a, b) => b - a);
}

/** Where a deadline's date came from, in the Designer's words. Nothing on file is a dash. */
export function deadlineSource(input: { sourceUrl: string | null; retrievedOn: string | null; receiptOn: string | null; ruleVersion: boolean }): string {
  if (input.sourceUrl) {
    let host = input.sourceUrl;
    try {
      host = new URL(input.sourceUrl).hostname.replace(/^www\./, "");
    } catch {
      // Keep the stored text.
    }
    return input.retrievedOn ? `${host}, retrieved ${dayMonth(input.retrievedOn)}` : host;
  }
  if (input.ruleVersion) return "Published rule version";
  if (input.receiptOn) return `Letter received ${dayMonth(input.receiptOn)}`;
  return "—";
}

/** "Fri 30 Oct 17:00 ET · same zone" or "Mon 2 Nov · official time UTC". */
export function deadlineTime(
  input: { dueOn: string | null; dueAt: string | null; timezone: string },
  firmZone: string,
  today: string,
): { left: string; right: string } {
  const left = dueLabel(input.dueOn, input.dueAt, firmZone, today);
  const at = input.dueAt ? new Date(input.dueAt) : new Date();
  const right = input.timezone === firmZone ? "same zone" : `official time ${zoneAbbr(input.timezone, at)}`;
  return { left, right };
}

/** Staff roles the task controls are offered to (public.set_task_status and public.update_task accept them). */
export const TASK_STAFF_ROLES: readonly string[] = ["firm_owner", "licensed_consultant", "case_manager", "assistant"];
/** Who may create a task (app.create_task): the same staff. A finance user may not. */
export const TASK_CREATE_ROLES: readonly string[] = TASK_STAFF_ROLES;
/** Who may run public.escalate_overdue_work: a firm owner or licensed consultant. */
export const TASK_ESCALATE_ROLES: readonly string[] = ["firm_owner", "licensed_consultant"];
/** Who may give a task to someone else (app.reassign_task): not an assistant. */
export const TASK_REASSIGN_ROLES: readonly string[] = ["firm_owner", "licensed_consultant", "case_manager"];

/**
 * Whether the signed-in member may confirm a tentative deadline, as public.confirm_deadline decides:
 * a legal or letter date needs a licensed member (an owner counts, decision 2026-10-19) and an
 * official source or published rule; an internal target needs an owner, consultant or case manager.
 * The database checks it again, with the step-up.
 */
export function deadlineConfirmable(
  deadline: { kind: string; verification: string; sourceUrl: string | null; ruleVersionId: string | null },
  role: string,
  licensed: boolean,
): { ok: true } | { ok: false; why: string | null } {
  if (deadline.verification === "confirmed") return { ok: false, why: null };
  if (deadline.kind === "internal") {
    return ["firm_owner", "licensed_consultant", "case_manager"].includes(role)
      ? { ok: true }
      : { ok: false, why: "A firm owner, consultant or case manager confirms an internal target." };
  }
  if (!licensed) return { ok: false, why: "A licensed consultant or the firm owner confirms a legal or letter deadline." };
  if (!deadline.sourceUrl && !deadline.ruleVersionId) {
    return { ok: false, why: "It stays tentative until it cites its official source or a published rule." };
  }
  return { ok: true };
}

/** The Manage button's `data-*` on a task row (Tasks page and the matter's Tasks tab). */
export function taskManageWire(task: {
  id: string;
  version: number;
  title: string;
  audience: string;
  due_on: string | null;
  owner_membership_id: string | null;
}): Record<`data-${string}`, string> {
  return {
    "data-task-open": task.id,
    "data-version": String(task.version),
    "data-title": task.title,
    "data-due": task.due_on ?? "",
    "data-owner": task.owner_membership_id ?? "",
    "data-audience": task.audience,
  };
}

/** The first word of a name, the way the Designer labels a task owner ("Daniel"). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}
