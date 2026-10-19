/**
 * Pure helpers behind the Sheet home's controls: the task bar's filter tokens and matching, the
 * quick actions, the right column's month calendar and the notification links. No DOM, no I/O,
 * so the server loader, the client handlers and the tests share them.
 */

import { isoDate } from "@/modules/sheet/home-present";

/** How many open firm tasks the home reads, and how many it shows at once after filtering. */
export const HOME_TASK_READ = 30;
export const HOME_TASK_SHOWN = 8;

/**
 * A home task row's `data-f` tokens: `mine` when the viewer owns it, `today` when due today,
 * `overdue` when past due. Dates are `YYYY-MM-DD` in the firm's timezone.
 */
export function homeTaskTokens(row: { owner_membership_id: string | null; due_on: string | null }, viewerMembershipId: string, today: string): string {
  const tokens: string[] = [];
  if (row.owner_membership_id && row.owner_membership_id === viewerMembershipId) tokens.push("mine");
  if (row.due_on === today) tokens.push("today");
  else if (row.due_on && row.due_on < today) tokens.push("overdue");
  return tokens.join(" ");
}

export type FilterRow = { text: string; flags: string };

/**
 * Which rows a filter bar hides: a row shows when its text contains the search (case-insensitive)
 * and, with a chip on, it carries that chip's token. `cap` keeps at most that many matches showing.
 */
export function filterHidden(rows: FilterRow[], search: string, token: string, cap: number = Infinity): { hidden: boolean[]; shown: number } {
  const q = search.trim().toLowerCase();
  let shown = 0;
  const hidden = rows.map((row) => {
    const flags = row.flags.split(/\s+/).filter(Boolean);
    const match = (!q || row.text.toLowerCase().includes(q)) && (!token || flags.includes(token));
    if (!match || shown >= cap) return true;
    shown++;
    return false;
  });
  return { hidden, shown };
}

/**
 * The home's Mine and Today chips are exclusive, like the Tasks page's. With no All chip, clicking
 * the chip that is on turns it off and shows every open firm task. Returns the chip left on, or null.
 */
export function nextHomeChip(current: string | null, clicked: string): string | null {
  return current === clicked ? null : clicked;
}

/** The home's quick actions start the action on its page. */
export const HOME_QUICK = {
  // The Lead pipeline opens New lead on ?new=1 (pipeline-acts).
  lead: "/sheet/pipeline?new=1",
  // No matter context, so the request is made from a document's matter.
  document: "/sheet/documents",
  // Consultations opens Book for a client on ?dlg=book.
  consultation: "/sheet/consultations?dlg=book",
  // Finance opens New invoice on ?dlg=invoice.
  invoice: "/sheet/finance?dlg=invoice",
  draft: "/sheet/drafts",
} as const;

/** The firm-name button: there is no workspace switcher (one firm per staff session), so it opens Settings > Firm. */
export const FIRM_SETTINGS = "/sheet/settings";

/** The Tasks page, with its own filters; the home bar's Filter chip goes there. */
export const TASKS_PAGE = "/sheet/tasks";

/**
 * The month the home calendar shows: `?month=YYYY-MM` when valid (years 2000 to 2100), otherwise
 * the firm's current month.
 */
export function homeMonth(param: string | undefined, current: { year: number; month: number }): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(param ?? "");
  if (!match) return current;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return current;
  return { year, month };
}

/** `YYYY-MM` for a month `delta` months away. */
export function shiftMonth(year: number, month: number, delta: number): string {
  const index = year * 12 + (month - 1) + delta;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** The calendar arrows: the same page with the previous or next month. */
export function monthNav(path: string, year: number, month: number): { prev: string; next: string } {
  return { prev: `${path}?month=${shiftMonth(year, month, -1)}`, next: `${path}?month=${shiftMonth(year, month, 1)}` };
}

/** A calendar day opens the Calendar on that day's week (its `?week=` takes any date in the week). */
export function calendarDayHref(year: number, month: number, day: number): string {
  return `/sheet/calendar?week=${isoDate(year, month, day)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The matter an activity row is about: a matters row it names, or a `matter_id` in its context. */
export function activityMatter(row: { object_table: string | null; object_id: string | null; context: unknown }): string | null {
  if ((row.object_table === "public.matters" || row.object_table === "matters") && row.object_id && UUID.test(row.object_id)) return row.object_id;
  const context = row.context;
  if (context && typeof context === "object" && !Array.isArray(context)) {
    const id = (context as Record<string, unknown>).matter_id;
    if (typeof id === "string" && UUID.test(id)) return id;
  }
  return null;
}

/**
 * Where a home notification goes: documents to Documents, email to the Inbox, anything else about
 * one matter to that matter, otherwise the page for its kind, or the notifications list.
 */
export function notificationHref(action: string, matterId: string | null): string {
  const kind = action.split(".")[0];
  if (kind === "document") return "/sheet/documents";
  if (kind === "email") return "/sheet/inbox";
  if (matterId) return `/sheet/matters/${matterId}`;
  if (kind === "agreement") return "/sheet/agreements";
  if (kind === "invitation") return "/sheet/invitations";
  if (kind === "task") return "/sheet/tasks";
  if (kind === "deadline") return "/sheet/calendar?tab=deadlines";
  if (kind === "matter" || kind === "intake") return "/sheet/matters";
  return "/sheet/notifications";
}

/** The page's address without one query parameter (a dialog's flag once the dialog closes). */
export function withoutParam(pathname: string, search: string, key: string): string {
  const params = new URLSearchParams(search);
  params.delete(key);
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}
