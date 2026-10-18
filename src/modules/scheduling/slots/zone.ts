/**
 * Time zone math with no dependency: the offset at an instant comes from
 * `Intl.DateTimeFormat(..., { timeZone }).formatToParts`, and local wall time is turned into UTC
 * by trying the offsets in force just before and just after it. Runs on Workers and in browsers.
 * All instants are epoch milliseconds. Nothing here reads the clock.
 */
import { SlotInputError } from "./errors";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let format = formatters.get(tz);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        weekday: "short",
      });
    } catch {
      throw new SlotInputError("unknown_time_zone", `Unknown time zone: ${tz}`);
    }
    formatters.set(tz, format);
  }
  return format;
}

/** Throws a typed error for anything that is not an IANA zone this runtime knows. */
export function assertTimeZone(tz: unknown): asserts tz is string {
  if (typeof tz !== "string" || !tz.trim() || tz.length > 64) {
    throw new SlotInputError("unknown_time_zone", "A time zone is required.");
  }
  formatter(tz);
}

export function isTimeZone(tz: unknown): tz is string {
  try {
    assertTimeZone(tz);
    return true;
  } catch {
    return false;
  }
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

function wall(instant: number, tz: string): Wall {
  const parts = formatter(tz).formatToParts(new Date(instant));
  const out: Record<string, string> = {};
  for (const part of parts) out[part.type] = part.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAY[out.weekday] ?? 0,
  };
}

function rawOffset(instant: number, tz: string): number {
  const whole = Math.floor(instant / 1000) * 1000;
  const w = wall(whole, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - whole) / MINUTE);
}

// Every zone changes offset on a quarter hour of UTC, so the offset is constant inside each
// 15-minute UTC bucket. Caching per bucket keeps slot generation fast; the answer is the same.
const QUARTER = 15 * MINUTE;
const offsetCache = new Map<string, number>();

/** Minutes east of UTC in force at the instant (Toronto in winter: -300). */
export function offsetMinutes(instant: number, tz: string): number {
  if (!Number.isFinite(instant)) throw new SlotInputError("invalid_instant", "Not a valid instant.");
  const bucket = Math.floor(instant / QUARTER);
  const key = `${tz}|${bucket}`;
  const cached = offsetCache.get(key);
  if (cached !== undefined) return cached;
  const offset = rawOffset(bucket * QUARTER, tz);
  if (offsetCache.size > 200_000) offsetCache.clear();
  offsetCache.set(key, offset);
  return offset;
}

export type LocalTime = {
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" */
  time: string;
  /** ISO weekday, Monday = 1. */
  weekday: number;
  /** Minutes since local midnight. */
  minuteOfDay: number;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

export function utcToLocal(instant: number, tz: string): LocalTime {
  if (!Number.isFinite(instant)) throw new SlotInputError("invalid_instant", "Not a valid instant.");
  formatter(tz);
  const shifted = new Date(instant + offsetMinutes(instant, tz) * MINUTE);
  const [hour, minute] = [shifted.getUTCHours(), shifted.getUTCMinutes()];
  const day = shifted.getUTCDay();
  return {
    date: `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`,
    time: `${pad2(hour)}:${pad2(minute)}`,
    weekday: day === 0 ? 7 : day,
    minuteOfDay: hour * 60 + minute,
  };
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})(?::00)?$/;

/** A calendar date as [year, month, day], checked (no 30 February). */
export function parseDateISO(date: string): [number, number, number] {
  const match = typeof date === "string" ? DATE_RE.exec(date) : null;
  if (!match) throw new SlotInputError("invalid_date", `Not a date: ${String(date)}`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new SlotInputError("invalid_date", `Not a date: ${date}`);
  }
  return [y, m, d];
}

/** "HH:MM" (or "HH:MM:00") as minutes since midnight. "24:00" is allowed as an end of day. */
export function parseTimeHHMM(time: string): number {
  const match = typeof time === "string" ? TIME_RE.exec(time) : null;
  if (!match) throw new SlotInputError("invalid_time", `Not a time: ${String(time)}`);
  const [h, m] = [Number(match[1]), Number(match[2])];
  if (m > 59 || h > 24 || (h === 24 && m !== 0)) throw new SlotInputError("invalid_time", `Not a time: ${time}`);
  return h * 60 + m;
}

/** The calendar date `days` after `date` (negative goes back). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = parseDateISO(date);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

/** ISO weekday (Monday = 1) of a calendar date. */
export function weekdayOf(date: string): number {
  const [y, m, d] = parseDateISO(date);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

export type ResolveOptions = {
  /** Wall time that does not exist (spring forward): move it forward by the gap. */
  gap?: "forward";
  /** Wall time that happens twice (fall back): take the earlier instant. */
  overlap?: "earlier" | "later";
};

/**
 * The UTC instant of a local wall time. A time skipped by a DST jump resolves forward (02:30 on
 * a spring-forward night in Toronto becomes 03:30 EDT). A repeated time takes the earlier
 * occurrence unless `overlap: "later"`.
 */
export function localToUtc(dateISO: string, timeHHMM: string, tz: string, options: ResolveOptions = {}): number {
  assertTimeZone(tz);
  const [y, m, d] = parseDateISO(dateISO);
  const minutes = parseTimeHHMM(timeHHMM);
  const naive = Date.UTC(y, m - 1, d) + minutes * MINUTE;
  const before = offsetMinutes(naive - 26 * HOUR, tz);
  const after = offsetMinutes(naive + 26 * HOUR, tz);
  // An offset is right when the instant it gives really has that offset.
  const candidates = [...new Set([before, after, offsetMinutes(naive, tz)])]
    .filter((offset) => offsetMinutes(naive - offset * MINUTE, tz) === offset)
    .map((offset) => naive - offset * MINUTE)
    .sort((a, b) => a - b);
  if (candidates.length > 0) {
    return options.overlap === "later" ? candidates[candidates.length - 1] : candidates[0];
  }
  // A gap: the wall time never happens. Use the offset in force before the jump, which lands
  // the same distance past the jump as the wall time was past its start.
  return naive - before * MINUTE;
}
