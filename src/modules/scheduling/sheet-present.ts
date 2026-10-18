/** Pure presentation for the Consultations and Calendar pages. No I/O. */
import type { Chip, ConsultationRow, RowAction } from "@/components/sheet/designer/consultations";
import type { WeekBlock, WeekGrid } from "@/components/sheet/designer/calendar";
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

export function consultationRow(booking: StaffBooking, zone: string, now: number): ConsultationRow {
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
export function buildWeek(monday: string, today: string, items: WeekItem[], zone: string): WeekGrid {
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

export function deadlineNote(dueAt: string | null, zone: string, verified: boolean): { left: string; right: string } | string {
  const state = verified ? "Verified" : "Tentative, confirm";
  if (!dueAt) return { left: state, right: "end of day" };
  const at = Date.parse(dueAt);
  return { left: state, right: `${clock(at, zone)} ${zoneAbbr(at, zone)}` };
}
