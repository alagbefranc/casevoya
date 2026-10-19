/**
 * Sheet > Notifications (PRD OPS-04 unread status): the rows public.staff_notifications returns,
 * shaped for the Designer's page. Pure; the loader reads the database.
 */
import type { NotificationGroup, NotificationPart, NotificationRow, NotificationsTab } from "@/components/sheet/designer/notifications";
import { dayLabel, clockLabel } from "@/modules/messages/present";

export type NotificationItem = {
  id: string;
  kind: "message" | "document" | "payment" | "booking" | "deadline";
  occurred_at: string;
  matter_id: string | null;
  actor_name: string | null;
  subject: string | null;
  detail: string | null;
  href: string;
  read: boolean;
};

const KINDS = new Set(["message", "document", "payment", "booking", "deadline"]);
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** What the System tab lists: the rows Casevoya itself raises (card payments and deadline reminders). */
export const SYSTEM_KINDS = new Set<NotificationItem["kind"]>(["payment", "deadline"]);

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
    case "deadline": {
      const due = shortDate(item.detail);
      return ["Deadline reminder for ", { b: matterName(item.matter_id) }, `: ${item.subject ?? "deadline"}${due ? `, due ${due}` : ""}`];
    }
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
      lead: item.kind === "payment" || item.kind === "deadline" ? "system" : { name: item.actor_name?.trim() || "Client" },
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
