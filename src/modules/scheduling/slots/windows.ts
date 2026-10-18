/**
 * Weekly rules and date overrides, in the schedule's own zone, turned into UTC windows.
 * Each local day is resolved on its own, so 09:00 stays 09:00 across a DST change.
 */
import { SlotInputError } from "./errors";
import { merge, type Interval } from "./intervals";
import { addDays, assertTimeZone, localToUtc, parseDateISO, parseTimeHHMM, utcToLocal, weekdayOf } from "./zone";

/** A weekly range on an ISO weekday (Monday = 1). Overnight availability is two rows. */
export type WeeklyRule = { weekday: number; start: string; end: string };

/**
 * A date override. Both times null blocks the whole date. Ranges for a date replace that
 * weekday's rules; several ranges on one date are allowed.
 */
export type DateOverride = { date: string; start: string | null; end: string | null };

export type ScheduleInput = {
  rules: readonly WeeklyRule[];
  overrides: readonly DateOverride[];
  tz: string;
  fromUtc: number;
  toUtc: number;
};

function checkRange(start: string, end: string): { start: number; end: number } | null {
  const s = parseTimeHHMM(start);
  const e = parseTimeHHMM(end);
  if (s === 1440) throw new SlotInputError("invalid_time", "A range cannot start at 24:00.");
  if (e === s) return null; // a zero-length range offers nothing
  if (e < s) throw new SlotInputError("end_before_start", `The range ${start}–${end} ends before it starts.`);
  return { start: s, end: e };
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

function resolve(date: string, range: { start: number; end: number }, tz: string): Interval {
  const start = localToUtc(date, hhmm(range.start), tz, { gap: "forward", overlap: "earlier" });
  const end =
    range.end === 1440
      ? localToUtc(addDays(date, 1), "00:00", tz, { gap: "forward", overlap: "earlier" })
      : localToUtc(date, hhmm(range.end), tz, { gap: "forward", overlap: "earlier" });
  return { start, end };
}

/** Validates the schedule; throws a typed error for a bad zone, weekday, date or range. */
export function validateSchedule(input: Pick<ScheduleInput, "rules" | "overrides" | "tz">): void {
  assertTimeZone(input.tz);
  for (const rule of input.rules) {
    if (!Number.isInteger(rule.weekday) || rule.weekday < 1 || rule.weekday > 7) {
      throw new SlotInputError("invalid_weekday", `Weekday must be 1 (Monday) to 7 (Sunday).`);
    }
    checkRange(rule.start, rule.end);
  }
  for (const override of input.overrides) {
    parseDateISO(override.date);
    if ((override.start == null) !== (override.end == null)) {
      throw new SlotInputError("invalid_time", "An override has both times or neither.");
    }
    if (override.start != null && override.end != null) checkRange(override.start, override.end);
  }
}

/** UTC windows (half-open, merged) inside `[fromUtc, toUtc)`. */
export function expandSchedule(input: ScheduleInput): Interval[] {
  validateSchedule(input);
  if (!Number.isFinite(input.fromUtc) || !Number.isFinite(input.toUtc) || input.toUtc < input.fromUtc) {
    throw new SlotInputError("invalid_range", "The range ends before it starts.");
  }
  const byDate = new Map<string, DateOverride[]>();
  for (const override of input.overrides) {
    const list = byDate.get(override.date) ?? [];
    list.push(override);
    byDate.set(override.date, list);
  }
  const byWeekday = new Map<number, WeeklyRule[]>();
  for (const rule of input.rules) {
    const list = byWeekday.get(rule.weekday) ?? [];
    list.push(rule);
    byWeekday.set(rule.weekday, list);
  }

  // One local day either side, so a range that crosses UTC midnight is not lost.
  const first = addDays(utcToLocal(input.fromUtc, input.tz).date, -1);
  const last = addDays(utcToLocal(input.toUtc, input.tz).date, 1);
  const out: Interval[] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) {
    const overrides = byDate.get(date);
    // A date with an all-day block offers nothing, even beside ranges on the same date.
    const ranges = overrides
      ? overrides.some((o) => o.start == null)
        ? []
        : overrides.map((o) => checkRange(o.start as string, o.end as string))
      : (byWeekday.get(weekdayOf(date)) ?? []).map((r) => checkRange(r.start, r.end));
    for (const range of ranges) {
      if (!range) continue;
      const interval = resolve(date, range, input.tz);
      const start = Math.max(interval.start, input.fromUtc);
      const end = Math.min(interval.end, input.toUtc);
      if (end > start) out.push({ start, end });
    }
  }
  return merge(out);
}
