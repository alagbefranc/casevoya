/** Pure presentation for the Consultations and Calendar pages. No I/O. */
import type { Chip, ConsultationRow, MonthCal, OutcomeSummaryData, RowAction, SummaryDialogData } from "@/components/sheet/designer/consultations";
import type { WeekBlock, WeekGrid } from "@/components/sheet/designer/calendar";
import { monthGrid } from "@/modules/sheet/home-present";
import { clock, locationShort, shortWhen, zoneAbbr } from "./format";
import { addDays, utcToLocal, weekdayOf } from "./slots";

export type StaffBooking = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: string;
  hostName: string | null;
  locationKind: string;
  version: number;
  attendee: string;
};

export function bookingChip(status: string, startsAt: number, now: number): Chip {
  switch (status) {
    case "confirmed":
      return startsAt > now ? { tone: "blue", label: "Confirmed" } : { tone: "chg", label: "Record outcome" };
    case "held":
    case "pending_payment":
      return { tone: "rev", label: "Held" };
    case "cancelled":
      return { tone: "gr", label: "Cancelled" };
    case "no_show":
      return { tone: "bad", label: "No-show" };
    case "completed":
      return { tone: "ok", label: "Attended" };
    default:
      return { tone: "gr", label: "Expired" };
  }
}

/** The Consultation record tab's URL for one booking. */
export function recordHref(bookingId: string): string {
  return `/sheet/consultations?tab=record&id=${bookingId}`;
}

/**
 * One Upcoming row. With `live`, the row also names its booking type next to the client and opens
 * the consultation's record.
 */
export function consultationRow(booking: StaffBooking, zone: string, now: number, options: { live?: boolean } = {}): ConsultationRow {
  const row = designerRow(booking, zone, now);
  return options.live ? { ...row, client: { left: booking.attendee, right: booking.title }, href: recordHref(booking.id) } : row;
}

/** The Upcoming list (live): what's ahead, then the last two weeks; cancelled and expired bookings are left out. */
export function upcomingRows(bookings: StaffBooking[], zone: string, now: number): ConsultationRow[] {
  const kept = bookings.filter((b) => b.status !== "cancelled" && b.status !== "expired");
  const ahead = kept.filter((b) => Date.parse(b.startsAt) > now);
  const past = kept.filter((b) => Date.parse(b.startsAt) <= now).reverse();
  return [...ahead, ...past].map((booking) => consultationRow(booking, zone, now, { live: true }));
}

function designerRow(booking: StaffBooking, zone: string, now: number): ConsultationRow {
  const start = Date.parse(booking.startsAt);
  const base = { "data-booking": booking.id, "data-version": String(booking.version), "data-name": booking.attendee };
  const actions: RowAction[] = [];
  if (booking.status === "confirmed" && start > now) {
    actions.push({ label: "Reschedule", data: { "data-booking-open": "res", ...base } });
    actions.push({ label: "Cancel", data: { "data-booking-open": "can", ...base } });
  } else if (booking.status === "confirmed") {
    actions.push({ label: "Attended", data: { "data-booking-outcome": "completed", ...base } });
    actions.push({ label: "No-show", icon: "no-show", data: { "data-booking-outcome": "no_show", ...base } });
  }
  return {
    when: shortWhen(start, zone),
    client: booking.attendee,
    with: { left: booking.hostName ?? "—", right: locationShort(booking.locationKind) },
    // Consultation agreements are not linked to bookings yet.
    agreement: "—",
    fee: "No fee",
    state: bookingChip(booking.status, start, now),
    actions,
  };
}

const DAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Tue, Thu 09:00–17:00 EDT; Mon 10:00–12:00 EDT" (days grouped by identical hours). */
export function daysSummary(rules: { weekday: number; start: string; end: string }[], zone: string, now: number): string {
  if (rules.length === 0) return "No hours set";
  const byRange = new Map<string, number[]>();
  for (const rule of [...rules].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start))) {
    const key = `${rule.start}–${rule.end}`;
    byRange.set(key, [...(byRange.get(key) ?? []), rule.weekday]);
  }
  const abbr = zoneAbbr(now, zone);
  return [...byRange.entries()].map(([range, days]) => `${[...new Set(days)].map((d) => DAY_SHORT[d]).join(", ")} ${range} ${abbr}`).join("; ");
}

/** Monday of the week containing `date` (YYYY-MM-DD). */
export function mondayOf(date: string): string {
  return addDays(date, 1 - weekdayOf(date));
}

/** The week the calendar opens on: this week, or from Saturday on the coming one (the grid starts Monday). */
export function defaultWeekAnchor(today: string): string {
  return weekdayOf(today) >= 6 ? addDays(mondayOf(today), 7) : today;
}

export type WeekItem = {
  start: number;
  end: number;
  allDay?: boolean;
  block: Omit<WeekBlock, "height" | "offsetMin">;
};

/**
 * The Designer's week grid: Monday to Friday (Saturday and Sunday too when something falls on
 * them), hour rows from 9:00 to 16:00 widened to fit, each item in the cell of its start hour.
 */
export function buildWeek(monday: string, today: string, items: WeekItem[], zone: string, options: { live?: boolean } = {}): WeekGrid {
  if (options.live) return liveWeek(monday, today, items, zone);
  const dates = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  const local = items.map((item) => ({ item, at: utcToLocal(item.start, zone) }));
  const weekend = local.some(({ at }) => at.date === dates[5] || at.date === dates[6]);
  const shown = weekend ? dates : dates.slice(0, 5);
  let first = 9;
  let last = 16;
  for (const { item, at } of local) {
    if (item.allDay || !shown.includes(at.date)) continue;
    first = Math.min(first, Math.floor(at.minuteOfDay / 60));
    const endLocal = utcToLocal(Math.max(item.end - 1, item.start), zone);
    last = Math.max(last, endLocal.date === at.date ? Math.floor(endLocal.minuteOfDay / 60) : 23);
  }
  const hours = Array.from({ length: last - first + 1 }, (_, index) => ({
    label: `${first + index}:00`,
    cells: shown.map(() => [] as WeekBlock[]),
  }));
  for (const { item, at } of local) {
    const column = shown.indexOf(at.date);
    if (column < 0) continue;
    const hour = item.allDay ? first : Math.floor(at.minuteOfDay / 60);
    const minutes = Math.max(15, Math.round((item.end - item.start) / 60_000));
    const height = item.allDay ? 56 : Math.max(24, Math.round((minutes / 60) * 64) - 8);
    hours[hour - first].cells[column].push({ ...item.block, height, offsetMin: item.allDay ? 0 : at.minuteOfDay % 60 });
  }
  const label = (date: string) => `${DAY_SHORT[weekdayOf(date)]} ${Number(date.slice(8, 10))}`;
  return { days: shown.map((date) => ({ label: label(date), today: date === today })), hours };
}

/**
 * The live week: the same grid, plus an "All day" row at the top for date-only items (a deadline
 * with a date but no time is not at 9:00), items in a cell side by side (the grid's `live` flag),
 * and the hour rows sized by the timed items only.
 */
function liveWeek(monday: string, today: string, items: WeekItem[], zone: string): WeekGrid {
  const timed = items.filter((item) => !item.allDay);
  const allDay = items.filter((item) => item.allDay);
  const grid = buildWeek(monday, today, timed.length ? timed : [], zone);
  // The weekend shows when anything (timed or all day) falls on it.
  const dates = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  const dayOf = (item: WeekItem) => utcToLocal(item.start, zone).date;
  const weekend = items.some((item) => dayOf(item) === dates[5] || dayOf(item) === dates[6]);
  const shown = weekend ? dates : dates.slice(0, 5);
  if (weekend && grid.days.length === 5) {
    const label = (date: string) => `${DAY_SHORT[weekdayOf(date)]} ${Number(date.slice(8, 10))}`;
    grid.days = shown.map((date) => ({ label: label(date), today: date === today }));
    grid.hours = grid.hours.map((hour) => ({ ...hour, cells: [...hour.cells, [], []] }));
  }
  if (allDay.length) {
    const cells = shown.map(() => [] as WeekBlock[]);
    for (const item of allDay) {
      const column = shown.indexOf(dayOf(item));
      if (column >= 0) cells[column].push({ ...item.block, height: 0, offsetMin: 0 });
    }
    grid.hours = [{ label: "All day", cells, allDay: true }, ...grid.hours];
  }
  return { ...grid, live: true };
}

/** "2026-10" moved by whole months. */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * A live month box: the month's grid with today and the marked dates, arrows that go to the
 * previous and next month (`nav`), and days that open `day(date)` when given.
 */
export function monthBox(input: {
  month: string;
  today: string;
  marked: readonly string[];
  nav?: ((month: string) => string) | null;
  day?: ((date: string) => string) | null;
}): MonthCal {
  const [year, month] = input.month.split("-").map(Number);
  const todayDay = input.today.startsWith(input.month) ? Number(input.today.slice(8, 10)) : null;
  const marked = new Set(input.marked.filter((date) => date.startsWith(input.month)).map((date) => Number(date.slice(8, 10))));
  const grid = monthGrid(year, month, todayDay, marked);
  const prev = shiftMonth(input.month, -1);
  const next = shiftMonth(input.month, 1);
  const name = (value: string) => `${MONTH_LONG[Number(value.slice(5, 7)) - 1]} ${value.slice(0, 4)}`;
  return {
    month: grid.month,
    leading: grid.leading,
    days: grid.days.map((cell) => {
      if (!input.day) return cell;
      const date = `${input.month}-${String(cell.day).padStart(2, "0")}`;
      return { ...cell, href: input.day(date), label: `Show the week of ${cell.day} ${MONTH_LONG[month - 1]}` };
    }),
    nav: input.nav ? { prev: input.nav(prev), next: input.nav(next), prevLabel: `Show ${name(prev)}`, nextLabel: `Show ${name(next)}` } : null,
  };
}

/** The Consultation record's outcome: its chip and one line saying what was recorded. */
export function recordOutcome(
  booking: { status: string; startsAt: string; outcomeAt: string | null; cancelledAt: string | null; cancelledBy: string | null; cancelReason: string | null },
  zone: string,
  now: number,
): { chip: Chip; copy: string } {
  const start = Date.parse(booking.startsAt);
  const chip = bookingChip(booking.status, start, now);
  const when = (iso: string | null) => (iso ? shortWhen(Date.parse(iso), zone) : null);
  const by = booking.cancelledBy === "client" ? "by the client" : booking.cancelledBy === "staff" ? "by the firm" : "";
  switch (booking.status) {
    case "completed":
      return { chip, copy: `Attended.${booking.outcomeAt ? ` Recorded ${when(booking.outcomeAt)}.` : ""}` };
    case "no_show":
      return { chip, copy: `No-show: the client didn’t attend.${booking.outcomeAt ? ` Recorded ${when(booking.outcomeAt)}.` : ""}` };
    case "cancelled":
      return { chip, copy: `Cancelled${by ? ` ${by}` : ""}${booking.cancelledAt ? ` on ${when(booking.cancelledAt)}` : ""}${booking.cancelReason ? `: ${booking.cancelReason}` : "."}` };
    case "expired":
      return { chip, copy: "The hold expired before the booking was confirmed." };
    case "held":
    case "pending_payment":
      return { chip, copy: "Held: the booking isn’t confirmed yet." };
    default:
      return start > now
        ? { chip, copy: "Booked. Record whether they attended after the meeting." }
        : { chip, copy: "The meeting time has passed. Record whether they attended." };
  }
}

const EVENT_LABEL: Record<string, string> = {
  held: "Time held",
  confirmed: "Booking confirmed",
  rescheduled: "Rescheduled",
  cancelled: "Cancelled",
  expired: "Hold expired",
  no_show: "Marked no-show",
  completed: "Marked attended",
};

export function bookingEventLabel(kind: string): string {
  return EVENT_LABEL[kind] ?? "Updated";
}

export function deadlineNote(dueAt: string | null, zone: string, verified: boolean): { left: string; right: string } | string {
  const state = verified ? "Verified" : "Tentative, confirm";
  if (!dueAt) return { left: state, right: "end of day" };
  const at = Date.parse(dueAt);
  return { left: state, right: `${clock(at, zone)} ${zoneAbbr(at, zone)}` };
}

/** Booking page tab: a published sample type is a practice page (staff only, sample bookings). */
export type BookingPageState = "live" | "practice" | "none";

export const BOOKING_PAGE_PILL: Record<BookingPageState, string> = {
  live: "Booking page live",
  practice: "Practice booking page (team only)",
  none: "Booking page not published",
};

/** Published types with real pages first, so the share link is the real page when one exists. */
export function bookingPagesInOrder<T extends { is_sample: boolean }>(published: T[]): T[] {
  return [...published.filter((type) => !type.is_sample), ...published.filter((type) => type.is_sample)];
}

export function bookingPageState(published: { is_sample: boolean }[]): BookingPageState {
  if (published.some((type) => !type.is_sample)) return "live";
  return published.length ? "practice" : "none";
}

/** The chip on a booking type row. */
export function bookingTypeState(type: { is_published: boolean; is_sample: boolean }): Chip {
  if (type.is_published) return type.is_sample ? { tone: "chg", label: "Practice page" } : { tone: "ok", label: "Published" };
  return type.is_sample ? { tone: "gr", label: "Sample" } : { tone: "gr", label: "Not published" };
}

export type CalendarConnectionRow = { name: string; tool: string; logo: string | null; chip: Chip };

/**
 * Connected calendars on the Calendar page: each staff member's Google Calendar busy-time
 * connection (`staff_connections`, toolkit googlecalendar). RLS shows a firm owner every row and
 * anyone else only their own, so a non-owner sees only themselves rather than a guess for others.
 */
export function calendarConnections(
  members: { membershipId: string; name: string }[],
  connections: { membership_id: string; toolkit: string; status: string }[],
  viewer: { membershipId: string; owner: boolean },
): CalendarConnectionRow[] {
  const google = new Map(connections.filter((row) => row.toolkit === "googlecalendar").map((row) => [row.membership_id, row.status]));
  return members
    .filter((member) => viewer.owner || member.membershipId === viewer.membershipId)
    .map((member) => {
      const status = google.get(member.membershipId);
      if (status === "active") {
        return { name: member.name, tool: "Google Calendar · busy times", logo: "/assets/logos/googlecalendar.svg", chip: { tone: "ok", label: "Connected" } };
      }
      if (status === "pending") {
        return { name: member.name, tool: "Google Calendar", logo: "/assets/logos/googlecalendar.svg", chip: { tone: "chg", label: "Finishing setup" } };
      }
      return { name: member.name, tool: "no calendar connected", logo: null, chip: { tone: "gr", label: "Not connected" } };
    });
}

/**
 * The record's "Outcome summary for …" panel and its dialog (CRM-04). Written by staff after an
 * attended consultation; a licensed reviewer approves and shares it; editing after that needs
 * review again, while the client keeps seeing the shared text.
 */
export function summaryView(input: {
  first: string;
  attended: boolean;
  reviewer: boolean;
  row: { body: string; status: string; shared_body: string | null; shared_at: string | null; version: number } | null;
  wire: Record<string, string>;
}): { panel: OutcomeSummaryData; dialog: SummaryDialogData | null } {
  const { row } = input;
  const version = String(row?.version ?? 0);
  const waiting = row?.status === "needs_review";
  const panel: OutcomeSummaryData = {
    title: `Outcome summary for ${input.first}`,
    chip: !row ? null : waiting ? { tone: "rev", label: "Needs consultant review" } : { tone: "ok", label: `Shared with ${input.first}` },
    body: row?.body ?? null,
    empty: input.attended
      ? `Not written yet. Write what was discussed and the next step; a licensed consultant reviews it before ${input.first} sees it.`
      : "Written after the consultation, once it’s marked attended.",
    share:
      input.reviewer && waiting
        ? { "data-summary-share": "1", ...input.wire, "data-version": version, "data-done": `Shared with ${input.first}`, "data-sub": "They see it in their portal." }
        : null,
    edit: input.attended ? { label: row ? "Edit" : "Write the summary", attrs: { "data-dlg": "dlgSum" } } : null,
    sharedNote: waiting && row?.shared_body ? `${input.first} still sees the version shared before, until this one is approved.` : null,
  };
  const dialog: SummaryDialogData | null = input.attended
    ? {
        title: `Outcome summary for ${input.first}`,
        body: row?.body ?? "",
        hint: input.reviewer ? "Saved for review. Then Approve and share sends it to their portal." : "A licensed consultant reviews it before the client sees it.",
        submit: { "data-summary-save": "1", ...input.wire, "data-version": version },
      }
    : null;
  return { panel, dialog };
}
