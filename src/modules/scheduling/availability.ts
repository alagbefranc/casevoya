/**
 * Turns the database's availability payload (`booking_public_busy` / `staff_booking_availability`)
 * into slot starts with the pure slot library. Each host is cut in their own schedule zone; the
 * starts of all hosts are merged (v1 gives a start to the first free host when it is booked).
 */
import { expandSchedule, generateSlots, type DateOverride, type Interval, type WeeklyRule } from "./slots";

export type AvailabilityHost = {
  position: number;
  membershipId?: string;
  timeZone: string;
  rules: WeeklyRule[];
  overrides: DateOverride[];
  busy: Interval[];
  dayCounts: Record<string, number>;
};

export type AvailabilityPayload = {
  event: {
    durationMin: number;
    slotStepMin: number | null;
    bufferBeforeMin: number;
    bufferAfterMin: number;
    minNoticeMin: number;
    maxAdvanceDays: number;
    dailyCapacity: number | null;
  };
  /** The database clock when the payload was read. */
  now: number;
  hosts: AvailabilityHost[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function int(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function instant(value: unknown): number {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : NaN;
}

function hhmm(value: unknown): string | null {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value) ? value : null;
}

/** Parses the JSON the database returns. Malformed rows are dropped, never guessed. */
export function parseAvailability(raw: unknown): AvailabilityPayload | null {
  const root = record(raw);
  const event = record(root.event);
  if (!Array.isArray(root.hosts) || typeof event.duration_min !== "number") return null;
  const hosts: AvailabilityHost[] = [];
  for (const item of root.hosts) {
    const host = record(item);
    if (typeof host.time_zone !== "string") continue;
    const rules = (Array.isArray(host.rules) ? host.rules : [])
      .map(record)
      .map((rule) => ({ weekday: int(rule.weekday, 0), start: hhmm(rule.start), end: hhmm(rule.end) }))
      .filter((rule): rule is WeeklyRule => rule.weekday >= 1 && rule.weekday <= 7 && rule.start !== null && rule.end !== null);
    const overrides = (Array.isArray(host.overrides) ? host.overrides : [])
      .map(record)
      .filter((o) => typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date))
      .map((o) => ({ date: o.date as string, start: hhmm(o.start), end: hhmm(o.end) }))
      .filter((o) => (o.start === null) === (o.end === null));
    const busy = (Array.isArray(host.busy) ? host.busy : [])
      .map(record)
      .map((b) => ({ start: instant(b.start), end: instant(b.end) }))
      .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start);
    const counts: Record<string, number> = {};
    for (const [day, n] of Object.entries(record(host.day_counts))) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && typeof n === "number") counts[day] = n;
    }
    hosts.push({
      position: int(host.position, hosts.length + 1),
      membershipId: typeof host.membership_id === "string" ? host.membership_id : undefined,
      timeZone: host.time_zone,
      rules,
      overrides,
      busy,
      dayCounts: counts,
    });
  }
  const now = instant(root.now);
  return {
    event: {
      durationMin: event.duration_min as number,
      slotStepMin: typeof event.slot_step_min === "number" ? event.slot_step_min : null,
      bufferBeforeMin: int(event.buffer_before_min, 0),
      bufferAfterMin: int(event.buffer_after_min, 0),
      minNoticeMin: int(event.min_notice_min, 0),
      maxAdvanceDays: int(event.max_advance_days, 60),
      dailyCapacity: typeof event.daily_capacity === "number" ? event.daily_capacity : null,
    },
    now: Number.isFinite(now) ? now : NaN,
    hosts,
  };
}

export type SlotOptions = {
  fromUtc: number;
  toUtc: number;
  nowUtc: number;
  /** Staff are not held to the minimum notice. */
  ignoreNotice?: boolean;
  /** Only this host (reschedule keeps the host). */
  membershipId?: string;
};

/** Slot starts (epoch ms) offered by any host, ascending and unique. */
export function slotsFromAvailability(payload: AvailabilityPayload, options: SlotOptions): number[] {
  const all = new Set<number>();
  for (const host of payload.hosts) {
    if (options.membershipId && host.membershipId !== options.membershipId) continue;
    const windows = expandSchedule({ rules: host.rules, overrides: host.overrides, tz: host.timeZone, fromUtc: options.fromUtc, toUtc: options.toUtc });
    const starts = generateSlots({
      windows,
      busy: host.busy,
      durationMin: payload.event.durationMin,
      stepMin: payload.event.slotStepMin,
      bufferBeforeMin: payload.event.bufferBeforeMin,
      bufferAfterMin: payload.event.bufferAfterMin,
      minNoticeMin: options.ignoreNotice ? 0 : payload.event.minNoticeMin,
      maxAdvanceDays: payload.event.maxAdvanceDays,
      nowUtc: options.nowUtc,
      alignTz: host.timeZone,
      maxPerDay: payload.event.dailyCapacity,
      dayCounts: host.dayCounts,
    });
    for (const start of starts) all.add(start);
  }
  return [...all].sort((a, b) => a - b);
}
