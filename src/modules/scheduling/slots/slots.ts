/**
 * Cuts availability windows into bookable starts.
 *
 * A start `s` is offered only when:
 *   - `[s, s + duration)` sits inside one window;
 *   - `[s - bufferBefore, s + duration + bufferAfter)` misses every busy interval (busy ranges of
 *     existing bookings already carry their own buffers, so buffers apply on both sides);
 *   - `s >= now + minNotice` (elapsed minutes, not wall time);
 *   - its local date (in `alignTz`) is no later than today + maxAdvanceDays;
 *   - its local date has fewer than `maxPerDay` bookings, when a daily capacity is set.
 * Starts are aligned to `stepMin` on the local clock of `alignTz` (minutes since local midnight),
 * so +05:30 and +05:45 zones align on their own :00 and :30. A wall time that repeats when
 * clocks fall back is offered once (the earlier occurrence). Time is passed in; nothing reads the clock.
 */
import { SlotInputError } from "./errors";
import { merge, overlapsAny, type Interval } from "./intervals";
import { addDays, assertTimeZone, utcToLocal } from "./zone";

const MINUTE = 60_000;

export type SlotInput = {
  windows: readonly Interval[];
  busy: readonly Interval[];
  durationMin: number;
  /** Null or undefined: the step equals the duration. */
  stepMin?: number | null;
  bufferBeforeMin?: number;
  bufferAfterMin?: number;
  minNoticeMin?: number;
  maxAdvanceDays?: number;
  nowUtc: number;
  alignTz: string;
  /** Daily capacity for this host, counted on `alignTz` dates. */
  maxPerDay?: number | null;
  /** Bookings already counted against the capacity, by local date ("YYYY-MM-DD"). */
  dayCounts?: Readonly<Record<string, number>>;
};

/** Epoch milliseconds of a slot start. */
export type SlotStart = number;

function whole(value: unknown, code: ConstructorParameters<typeof SlotInputError>[0], min: number, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new SlotInputError(code, `${label} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

export function generateSlots(input: SlotInput): SlotStart[] {
  assertTimeZone(input.alignTz);
  const duration = whole(input.durationMin, "invalid_duration", 5, 1440, "Duration");
  const step = input.stepMin == null ? duration : whole(input.stepMin, "invalid_step", 5, 1440, "Step");
  const before = whole(input.bufferBeforeMin ?? 0, "invalid_buffer", 0, 1440, "Buffer before");
  const after = whole(input.bufferAfterMin ?? 0, "invalid_buffer", 0, 1440, "Buffer after");
  const notice = whole(input.minNoticeMin ?? 0, "invalid_notice", 0, 525_600, "Minimum notice");
  const advance = whole(input.maxAdvanceDays ?? 365, "invalid_advance", 0, 3660, "Booking window");
  const cap = input.maxPerDay == null ? null : whole(input.maxPerDay, "invalid_capacity", 1, 1000, "Daily capacity");
  if (!Number.isFinite(input.nowUtc)) throw new SlotInputError("invalid_instant", "Now must be an instant.");

  const windows = merge(input.windows);
  const busy = merge(input.busy);
  const earliest = input.nowUtc + notice * MINUTE;
  const lastDate = addDays(utcToLocal(input.nowUtc, input.alignTz).date, advance);
  const counts = new Map<string, number>(Object.entries(input.dayCounts ?? {}));
  const seenWall = new Set<string>();
  const out: SlotStart[] = [];

  for (const window of windows) {
    let s = Math.max(window.start, earliest);
    // Whole minutes only.
    s = Math.ceil(s / MINUTE) * MINUTE;
    while (s + duration * MINUTE <= window.end) {
      const local = utcToLocal(s, input.alignTz);
      const off = local.minuteOfDay % step;
      if (off !== 0) {
        s += (step - off) * MINUTE;
        continue;
      }
      if (local.date > lastDate) break;
      const wallKey = `${local.date} ${local.time}`;
      const blocked = overlapsAny(busy, s - before * MINUTE, s + (duration + after) * MINUTE);
      const full = cap != null && (counts.get(local.date) ?? 0) >= cap;
      if (!blocked && !full && !seenWall.has(wallKey)) {
        out.push(s);
        seenWall.add(wallKey);
      }
      s += step * MINUTE;
    }
  }
  return out.sort((a, b) => a - b);
}

/** True when `start` is one of the starts the same input would offer (server-side re-check). */
export function isOfferedStart(input: SlotInput, start: number): boolean {
  if (!Number.isFinite(start)) return false;
  const window = { start: start - 1, end: start + (input.durationMin + 1) * MINUTE };
  const narrowed = merge(input.windows).filter((w) => w.end > window.start && w.start < window.end);
  // Alignment is local-clock based, so recompute over the windows that contain the start.
  return generateSlots({ ...input, windows: narrowed }).includes(start);
}
