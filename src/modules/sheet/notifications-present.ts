/**
 * Sheet > Notifications (PRD OPS-04 unread status): the rows public.staff_notifications returns,
 * shaped for the Designer's page. Pure; the loader reads the database.
 */
import type { NotificationGroup, NotificationPart, NotificationRow, NotificationsTab } from "@/components/sheet/designer/notifications";
import { dayLabel, clockLabel } from "@/modules/messages/present";

export type NotificationItem = {
  id: string;
  kind: "message" | "document" | "payment" | "booking" | "booking_cancelled" | "booking_rescheduled" | "deadline" | "support" | "intake_submitted" | "intake_correction" | "task" | "report" | "document_blocked";
  occurred_at: string;
  matter_id: string | null;
  actor_name: string | null;
  subject: string | null;
  detail: string | null;
  href: string;
  read: boolean;
};

const KINDS = new Set(["message", "document", "payment", "booking", "booking_cancelled", "booking_rescheduled", "deadline", "support", "intake_submitted", "intake_correction", "task", "report", "document_blocked"]);
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** What the System tab lists: the rows Casevoya itself raises (card payments, deadline reminders, support requests). */
export const SYSTEM_KINDS = new Set<NotificationItem["kind"]>(["payment", "deadline", "support", "report", "document_blocked"]);

/** How many notifications the page and the sidebar read: the most public.staff_notifications returns. */
export const NOTIFICATION_READ_LIMIT = 200;

/** The sidebar's Notifications count: unread rows, on every Sheet page. */
export function unreadCount(items: readonly NotificationItem[]): number {
  return items.filter((item) => !item.read).length;
}

/** A matter as notification rows name it: its reference, then its title. */
export function matterLabel(matter: { reference: string | null; title: string } | undefined): string {
  if (!matter) return "a matter";
  return matter.reference ? `${matter.reference} (${matter.title})` : matter.title;
}

export function notificationsTab(raw: string | undefined): NotificationsTab {
  return raw === "mentions" || raw === "system" ? raw : "all";
}

/** Only well-formed rows from the database; anything else is dropped rather than guessed. */
export function readItems(raw: unknown): NotificationItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (row): row is NotificationItem =>
      Boolean(row) &&
      typeof row === "object" &&
      typeof (row as NotificationItem).id === "string" &&
      KINDS.has((row as NotificationItem).kind) &&
      typeof (row as NotificationItem).occurred_at === "string" &&
      typeof (row as NotificationItem).href === "string" &&
      (row as NotificationItem).href.startsWith("/sheet/"),
  );
}

function first(name: string | null): string {
  return (name ?? "").trim().split(/\s+/)[0] || "A client";
}

/** "2026-10-30" or "2026-10-30T17:00" as "Fri 30 Oct" / "Fri 30 Oct, 17:00". */
export function shortDate(value: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?$/.exec(value ?? "");
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  const day = `${WEEKDAY[date.getUTCDay()]} ${date.getUTCDate()} ${MONTH[date.getUTCMonth()]}`;
  return match[4] ? `${day}, ${match[4]}` : day;
}

/** One row's sentence, in the Designer's form: plain text with the subject in bold. */
export function notificationParts(item: NotificationItem, matterName: (id: string | null) => string): NotificationPart[] {
  switch (item.kind) {
    case "message":
      // The matter it is on (its reference, or its title), not the client's own name again.
      return [`${first(item.actor_name)} sent a message on `, { b: matterName(item.matter_id) }];
    case "document":
      return [`${first(item.actor_name)} uploaded `, { b: item.subject ?? "a document" }, item.detail ? ` (${item.detail})` : ""].filter(Boolean);
    case "payment":
      return ["Card payment received for ", { b: item.subject ?? "an invoice" }];
    case "booking": {
      const when = shortDate(item.detail);
      return [`${item.actor_name?.trim() || "Someone"} booked `, { b: item.subject ?? "a consultation" }, when ? `: ${when}` : ""].filter(Boolean);
    }
    // Portal appointments (20261020150100): a client cancelled or moved their own consultation.
    case "booking_cancelled": {
      const when = shortDate(item.detail);
      return [`${item.actor_name?.trim() || "A client"} cancelled `, { b: item.subject ?? "a consultation" }, when ? `, ${when}` : ""].filter(Boolean);
    }
    case "booking_rescheduled": {
      const when = shortDate(item.detail);
      return [`${item.actor_name?.trim() || "A client"} moved `, { b: item.subject ?? "a consultation" }, when ? ` to ${when}` : ""].filter(Boolean);
    }
    case "deadline": {
      const due = shortDate(item.detail);
      return ["Deadline reminder for ", { b: matterName(item.matter_id) }, `: ${item.subject ?? "deadline"}${due ? `, due ${due}` : ""}`];
    }
    // Support access (SEC-09): the minutes asked for and what it would open; nothing opens until approved.
    case "support": {
      const minutes = /^\d+$/.test(item.detail ?? "") ? `${item.detail} minutes of access` : "access";
      return ["Casevoya support asked for ", { b: minutes }, ` to ${item.subject ?? "your firm"}. Nothing opens until you approve`];
    }
    // Intake delivery (20261020180100): a client sent a form, or asked for a correction after sending.
    case "intake_submitted":
      return [`${first(item.actor_name)} sent `, { b: item.subject ?? "an intake form" }, " on ", { b: matterName(item.matter_id) }];
    case "intake_correction":
      return [`${first(item.actor_name)} asked for a correction to `, { b: item.subject ?? "an intake form" }, item.detail ? ` (${item.detail})` : ""].filter(Boolean);
    // OPS-01 (20261025100100): a task you own, watch or lead changed status, moved or was escalated.
    case "task":
      return taskParts(item, matterName);
    // REP-03 (20261025320100): a scheduled report's link (or its test run). Link only; sign-in shows it.
    case "report":
      return [item.detail === "test" ? "Test of scheduled report " : "Scheduled report ", { b: item.subject ?? "a report" }, " is ready to open in Reports"];
    // #263-B (20261028130100): the virus scanner blocked a file, or couldn't check it after every retry.
    case "document_blocked":
      return item.detail === "infected"
        ? ["Blocked: a virus was found in ", { b: item.subject ?? "a document" }, " on ", { b: matterName(item.matter_id) }, ". Nobody can open it; ask the client for another copy"]
        : ["Couldn’t be checked yet: ", { b: item.subject ?? "a document" }, " on ", { b: matterName(item.matter_id) }, ". The virus check didn’t run; Casevoya keeps trying, and nobody can open it until it passes"];
  }
}

const TASK_STATUS: Record<string, string> = { open: "reopened", blocked: "marked blocked", done: "marked done", cancelled: "cancelled" };

function taskParts(item: NotificationItem, matterName: (id: string | null) => string): NotificationPart[] {
  const who = item.actor_name?.trim() || "Someone";
  const task = { b: item.subject ?? "a task" };
  const where: NotificationPart[] = item.matter_id ? [" on ", { b: matterName(item.matter_id) }] : [];
  switch (item.detail) {
    case "reassigned_you":
      return [`${who} gave you `, task, ...where];
    case "reassigned":
      return [`${who} reassigned `, task, ...where];
    case "escalated":
      return ["Overdue and escalated: ", task, ...where];
    default:
      return [`${who} ${TASK_STATUS[item.detail ?? ""] ?? "changed"} `, task, ...where];
  }
}

/** Rows grouped by the firm's calendar day, newest first, for the open tab. */
export function notificationGroups(input: {
  items: NotificationItem[];
  tab: NotificationsTab;
  now: string;
  timezone: string;
  matterName: (id: string | null) => string;
}): NotificationGroup[] {
  if (input.tab === "mentions") return [];
  const items = input.items
    .filter((item) => input.tab === "all" || SYSTEM_KINDS.has(item.kind))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const groups: NotificationGroup[] = [];
  for (const item of items) {
    const label = dayLabel(item.occurred_at, input.now, input.timezone);
    const row: NotificationRow = {
      id: item.id,
      href: item.href,
      lead: SYSTEM_KINDS.has(item.kind) ? "system" : { name: item.actor_name?.trim() || "Client" },
      parts: notificationParts(item, input.matterName),
      time: clockLabel(item.occurred_at, input.timezone),
      unread: !item.read,
    };
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  return groups;
}
