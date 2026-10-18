/** Half-open UTC intervals `[start, end)` in epoch milliseconds. Pure set algebra. */
export type Interval = { start: number; end: number };

const MINUTE = 60_000;

function valid(interval: Interval): boolean {
  return Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start;
}

/** Sorted, non-overlapping, with touching intervals joined. Empty intervals are dropped. */
export function merge(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter(valid).map((i) => ({ start: i.start, end: i.end })).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const next of sorted) {
    const last = out[out.length - 1];
    if (last && next.start <= last.end) {
      if (next.end > last.end) last.end = next.end;
    } else {
      out.push(next);
    }
  }
  return out;
}

/** `base` minus every cut. Touching edges do not cut (half-open). */
export function subtract(base: readonly Interval[], cuts: readonly Interval[]): Interval[] {
  const pieces = merge(base);
  const holes = merge(cuts);
  const out: Interval[] = [];
  let h = 0;
  for (const piece of pieces) {
    let start = piece.start;
    const end = piece.end;
    while (h < holes.length && holes[h].end <= start) h++;
    let k = h;
    while (k < holes.length && holes[k].start < end) {
      const hole = holes[k];
      if (hole.start > start) out.push({ start, end: Math.min(hole.start, end) });
      start = Math.max(start, hole.end);
      if (start >= end) break;
      k++;
    }
    if (start < end) out.push({ start, end });
  }
  return out;
}

/** Where both sets overlap. */
export function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const left = merge(a);
  const right = merge(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const start = Math.max(left[i].start, right[j].start);
    const end = Math.min(left[i].end, right[j].end);
    if (end > start) out.push({ start, end });
    if (left[i].end < right[j].end) i++;
    else j++;
  }
  return out;
}

/** The interval widened by whole minutes on each side. */
export function pad(interval: Interval, beforeMin: number, afterMin: number): Interval {
  return { start: interval.start - beforeMin * MINUTE, end: interval.end + afterMin * MINUTE };
}

/** True when `[start, end)` meets any interval of a merged, sorted list (binary search). */
export function overlapsAny(sorted: readonly Interval[], start: number, end: number): boolean {
  let lo = 0;
  let hi = sorted.length;
  // First interval whose end is after `start`.
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].end <= start) lo = mid + 1;
    else hi = mid;
  }
  return lo < sorted.length && sorted[lo].start < end;
}

/** True when `[start, end)` sits inside one interval of a merged, sorted list. */
export function insideAny(sorted: readonly Interval[], start: number, end: number): boolean {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].end <= start) lo = mid + 1;
    else hi = mid;
  }
  return lo < sorted.length && sorted[lo].start <= start && sorted[lo].end >= end;
}
