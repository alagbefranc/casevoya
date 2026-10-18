import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  SlotInputError,
  decodeStarts,
  encodeStarts,
  expandSchedule,
  generateSlots,
  insideAny,
  isOfferedStart,
  merge,
  overlapsAny,
  pad,
  utcToLocal,
  type DateOverride,
  type Interval,
  type SlotInput,
  type WeeklyRule,
} from "@/modules/scheduling/slots";

const M = 60_000;
const H = 60 * M;
const D = 24 * H;
const T = Date.parse;
const TOR = "America/Toronto";
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16) + "Z";
const isoList = (list: number[]) => list.map(iso);
const local = (ms: number, tz = TOR) => {
  const l = utcToLocal(ms, tz);
  return `${l.date} ${l.time}`;
};

const WEEKDAYS_9_TO_5: WeeklyRule[] = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "09:00", end: "17:00" }));

function windows(rules: WeeklyRule[], overrides: DateOverride[], tz: string, from: string, to: string): Interval[] {
  return expandSchedule({ rules, overrides, tz, fromUtc: T(from), toUtc: T(to) });
}

function slots(input: Partial<SlotInput> & Pick<SlotInput, "windows" | "durationMin">): number[] {
  return generateSlots({ busy: [], nowUtc: T("2026-01-01T00:00:00Z"), alignTz: TOR, maxAdvanceDays: 3650, ...input });
}

describe("slot library: generateSlots (BUILD-SPEC §2)", () => {
  it("1. a Mon 09:00-17:00 Toronto rule gives the right UTC on an EDT date and an EST date", () => {
    const edt = windows([{ weekday: 1, start: "09:00", end: "17:00" }], [], TOR, "2026-10-19T00:00:00Z", "2026-10-20T12:00:00Z");
    expect(edt.map((w) => [iso(w.start), iso(w.end)])).toEqual([["2026-10-19T13:00Z", "2026-10-19T21:00Z"]]);
    const est = windows([{ weekday: 1, start: "09:00", end: "17:00" }], [], TOR, "2026-11-02T00:00:00Z", "2026-11-03T12:00:00Z");
    expect(est.map((w) => [iso(w.start), iso(w.end)])).toEqual([["2026-11-02T14:00Z", "2026-11-02T22:00Z"]]);
  });

  it("2. DST spring forward (8 Mar 2026, Toronto): a 02:00-03:00 rule resolves forward to nothing, and no slot is in the gap", () => {
    const gap = windows([{ weekday: 7, start: "02:00", end: "03:00" }], [], TOR, "2026-03-07T00:00:00Z", "2026-03-09T12:00:00Z");
    expect(gap).toEqual([]);
    const night = windows([{ weekday: 7, start: "01:00", end: "04:00" }], [], TOR, "2026-03-07T00:00:00Z", "2026-03-09T12:00:00Z");
    const starts = slots({ windows: night, durationMin: 30 });
    expect(starts.map((s) => local(s))).toEqual(["2026-03-08 01:00", "2026-03-08 01:30", "2026-03-08 03:00", "2026-03-08 03:30"]);
    expect(starts.some((s) => utcToLocal(s, TOR).time.startsWith("02:"))).toBe(false);
  });

  it("3. DST fall back (1 Nov 2026, Toronto): a 01:00-02:00 rule takes the earlier occurrence once, with no duplicate slot", () => {
    const w = windows([{ weekday: 7, start: "01:00", end: "02:00" }], [], TOR, "2026-10-31T00:00:00Z", "2026-11-02T00:00:00Z");
    const starts = slots({ windows: w, durationMin: 30 });
    expect(isoList(starts)).toEqual(["2026-11-01T05:00Z", "2026-11-01T05:30Z"]);
    const walls = starts.map((s) => local(s));
    expect(new Set(walls).size).toBe(walls.length);
  });

  it("4. host in Toronto, booker in Vancouver: the same UTC starts (rendering is the client's job)", () => {
    const w = windows(WEEKDAYS_9_TO_5, [], TOR, "2026-10-19T00:00:00Z", "2026-10-20T00:00:00Z");
    const forToronto = slots({ windows: w, durationMin: 60 });
    const forVancouver = slots({ windows: w, durationMin: 60 });
    expect(forVancouver).toEqual(forToronto);
    expect(local(forToronto[0], TOR)).toBe("2026-10-19 09:00");
    expect(local(forToronto[0], "America/Vancouver")).toBe("2026-10-19 06:00");
  });

  it("5. Asia/Kolkata (+05:30) and Asia/Kathmandu (+05:45) schedules align to local :00/:30", () => {
    for (const [tz, now] of [
      ["Asia/Kolkata", "2026-10-19T03:40:00Z"],
      ["Asia/Kathmandu", "2026-10-19T03:30:00Z"],
    ] as const) {
      const w = windows([{ weekday: 1, start: "09:00", end: "12:00" }], [], tz, "2026-10-18T00:00:00Z", "2026-10-20T00:00:00Z");
      const starts = generateSlots({ windows: w, busy: [], durationMin: 30, nowUtc: T(now), alignTz: tz });
      expect(starts.length).toBeGreaterThan(0);
      expect(local(starts[0], tz)).toBe("2026-10-19 09:30");
      for (const start of starts) expect(utcToLocal(start, tz).minuteOfDay % 30).toBe(0);
    }
  });

  it("6. an override with times replaces that weekday's rules", () => {
    const w = windows(WEEKDAYS_9_TO_5, [{ date: "2026-10-20", start: "13:00", end: "14:00" }], TOR, "2026-10-20T00:00:00Z", "2026-10-21T04:00:00Z");
    expect(slots({ windows: w, durationMin: 30 }).map((s) => local(s))).toEqual(["2026-10-20 13:00", "2026-10-20 13:30"]);
  });

  it("7. an override with null times blocks the whole day", () => {
    const w = windows(WEEKDAYS_9_TO_5, [{ date: "2026-10-20", start: null, end: null }], TOR, "2026-10-20T00:00:00Z", "2026-10-21T04:00:00Z");
    expect(w).toEqual([]);
  });

  it("8. several override ranges on one date", () => {
    const w = windows(
      WEEKDAYS_9_TO_5,
      [
        { date: "2026-10-20", start: "09:00", end: "10:00" },
        { date: "2026-10-20", start: "15:00", end: "16:00" },
      ],
      TOR,
      "2026-10-20T00:00:00Z",
      "2026-10-21T04:00:00Z",
    );
    expect(slots({ windows: w, durationMin: 60 }).map((s) => local(s))).toEqual(["2026-10-20 09:00", "2026-10-20 15:00"]);
  });

  it("9. an override on a date with no weekly rule adds availability", () => {
    const w = windows(WEEKDAYS_9_TO_5, [{ date: "2026-10-24", start: "10:00", end: "11:00" }], TOR, "2026-10-24T00:00:00Z", "2026-10-25T04:00:00Z");
    expect(slots({ windows: w, durationMin: 60 }).map((s) => local(s))).toEqual(["2026-10-24 10:00"]);
  });

  it("10. overnight availability as two rows across midnight", () => {
    const w = windows(
      [
        { weekday: 1, start: "22:00", end: "24:00" },
        { weekday: 2, start: "00:00", end: "02:00" },
      ],
      [],
      TOR,
      "2026-10-19T00:00:00Z",
      "2026-10-21T00:00:00Z",
    );
    expect(w.length).toBe(1);
    const starts = slots({ windows: w, durationMin: 60, stepMin: 30 });
    expect(starts.map((s) => local(s))).toEqual(["2026-10-19 22:00", "2026-10-19 22:30", "2026-10-19 23:00", "2026-10-19 23:30", "2026-10-20 00:00", "2026-10-20 00:30", "2026-10-20 01:00"]);
  });

  it("11. duration 60, step 30 gives overlapping starts; a null step equals the duration", () => {
    const w = windows([{ weekday: 1, start: "09:00", end: "11:00" }], [], TOR, "2026-10-19T00:00:00Z", "2026-10-20T00:00:00Z");
    expect(slots({ windows: w, durationMin: 60, stepMin: 30 }).map((s) => local(s))).toEqual(["2026-10-19 09:00", "2026-10-19 09:30", "2026-10-19 10:00"]);
    expect(slots({ windows: w, durationMin: 60, stepMin: null }).map((s) => local(s))).toEqual(["2026-10-19 09:00", "2026-10-19 10:00"]);
  });

  it("12. a slot that would overrun the window end is excluded, including by the last minute", () => {
    const hour = windows([{ weekday: 1, start: "09:00", end: "10:00" }], [], TOR, "2026-10-19T00:00:00Z", "2026-10-20T00:00:00Z");
    expect(slots({ windows: hour, durationMin: 30, stepMin: 15 }).map((s) => local(s))).toEqual(["2026-10-19 09:00", "2026-10-19 09:15", "2026-10-19 09:30"]);
    const short = windows([{ weekday: 1, start: "09:00", end: "09:59" }], [], TOR, "2026-10-19T00:00:00Z", "2026-10-20T00:00:00Z");
    expect(slots({ windows: short, durationMin: 30, stepMin: 15 }).map((s) => local(s))).toEqual(["2026-10-19 09:00", "2026-10-19 09:15"]);
  });

  it("13. a 24 h minimum notice from mid-day gives the next aligned start", () => {
    const w = windows(WEEKDAYS_9_TO_5, [], TOR, "2026-10-19T00:00:00Z", "2026-10-24T00:00:00Z");
    const starts = generateSlots({ windows: w, busy: [], durationMin: 30, minNoticeMin: 1440, nowUtc: T("2026-10-20T16:07:00Z"), alignTz: TOR });
    expect(local(starts[0])).toBe("2026-10-21 12:30");
  });

  it("14. minimum notice across a DST change counts elapsed minutes, not wall time", () => {
    const w = windows([{ weekday: 7, start: "09:00", end: "17:00" }], [], TOR, "2026-10-31T00:00:00Z", "2026-11-02T12:00:00Z");
    // Saturday 31 Oct 12:00 EDT + 24 h elapsed = Sunday 1 Nov 11:00 EST.
    const starts = generateSlots({ windows: w, busy: [], durationMin: 60, minNoticeMin: 1440, nowUtc: T("2026-10-31T16:00:00Z"), alignTz: TOR });
    expect(local(starts[0])).toBe("2026-11-01 11:00");
    expect(iso(starts[0])).toBe("2026-11-01T16:00Z");
  });

  it("15. the booking window ends at the end of the local day", () => {
    const every = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "09:00", end: "17:00" }));
    const w = windows(every, [], TOR, "2026-10-19T00:00:00Z", "2026-10-30T00:00:00Z");
    const starts = generateSlots({ windows: w, busy: [], durationMin: 60, maxAdvanceDays: 2, nowUtc: T("2026-10-19T16:00:00Z"), alignTz: TOR });
    const last = starts[starts.length - 1];
    expect(local(last)).toBe("2026-10-21 16:00");
    expect(starts.some((s) => utcToLocal(s, TOR).date === "2026-10-22")).toBe(false);
  });

  it("16. busy subtraction: touching an edge is allowed (half-open); a 1-minute overlap is not", () => {
    const w = windows([{ weekday: 1, start: "09:00", end: "12:00" }], [], TOR, "2026-10-19T00:00:00Z", "2026-10-20T00:00:00Z");
    const busy = [{ start: T("2026-10-19T14:00:00Z"), end: T("2026-10-19T14:30:00Z") }]; // 10:00-10:30 EDT
    const touching = slots({ windows: w, busy, durationMin: 30 }).map((s) => local(s));
    expect(touching).toContain("2026-10-19 09:30");
    expect(touching).toContain("2026-10-19 10:30");
    expect(touching).not.toContain("2026-10-19 10:00");
    const early = [{ start: T("2026-10-19T13:59:00Z"), end: T("2026-10-19T14:30:00Z") }];
    expect(slots({ windows: w, busy: early, durationMin: 30 }).map((s) => local(s))).not.toContain("2026-10-19 09:30");
  });

  it("17. buffers block adjacent slots, and a buffer may extend outside the window", () => {
    const w = windows([{ weekday: 1, start: "09:00", end: "12:00" }], [], TOR, "2026-10-19T00:00:00Z", "2026-10-20T00:00:00Z");
    const busy = [{ start: T("2026-10-19T14:00:00Z"), end: T("2026-10-19T14:30:00Z") }]; // 10:00-10:30
    const starts = slots({ windows: w, busy, durationMin: 30, stepMin: 15, bufferBeforeMin: 15, bufferAfterMin: 15 }).map((s) => local(s));
    expect(starts).toContain("2026-10-19 09:00"); // its 08:45 buffer is outside the window
    expect(starts).toContain("2026-10-19 09:15"); // ends with buffer at 10:00, touching
    expect(starts).not.toContain("2026-10-19 09:30");
    expect(starts).not.toContain("2026-10-19 10:30");
    expect(starts).toContain("2026-10-19 10:45");
  });

  it("18. an existing booking's own buffers are already in its blocked range, so they apply symmetrically", () => {
    const w = windows([{ weekday: 1, start: "09:00", end: "12:00" }], [], TOR, "2026-10-19T00:00:00Z", "2026-10-20T00:00:00Z");
    // Booked 10:00-11:00 with 15 minutes either side: blocked 09:45-11:15.
    const blocked = pad({ start: T("2026-10-19T14:00:00Z"), end: T("2026-10-19T15:00:00Z") }, 15, 15);
    const starts = slots({ windows: w, busy: [blocked], durationMin: 30, stepMin: 15 }).map((s) => local(s));
    expect(starts).toContain("2026-10-19 09:15");
    expect(starts).not.toContain("2026-10-19 09:30");
    expect(starts).not.toContain("2026-10-19 11:00");
    expect(starts).toContain("2026-10-19 11:15");
  });

  it("19. several busy sources (booking, hold, external) are merged", () => {
    const w = windows([{ weekday: 1, start: "09:00", end: "13:00" }], [], TOR, "2026-10-19T00:00:00Z", "2026-10-20T00:00:00Z");
    const booking = { start: T("2026-10-19T13:00:00Z"), end: T("2026-10-19T14:00:00Z") };
    const hold = { start: T("2026-10-19T13:30:00Z"), end: T("2026-10-19T15:00:00Z") };
    const external = { start: T("2026-10-19T16:00:00Z"), end: T("2026-10-19T16:30:00Z") };
    expect(slots({ windows: w, busy: [external, hold, booking], durationMin: 60 }).map((s) => local(s))).toEqual(["2026-10-19 11:00"]);
  });

  it("20. an empty schedule gives no slots, and a zero-length rule is ignored", () => {
    expect(slots({ windows: windows([], [], TOR, "2026-10-19T00:00:00Z", "2026-10-26T00:00:00Z"), durationMin: 30 })).toEqual([]);
    expect(windows([{ weekday: 1, start: "09:00", end: "09:00" }], [], TOR, "2026-10-19T00:00:00Z", "2026-10-26T00:00:00Z")).toEqual([]);
  });

  it("21. leap day (29 Feb 2028) and month-end ranges", () => {
    const tuesday = windows([{ weekday: 2, start: "10:00", end: "11:00" }], [], TOR, "2028-02-27T00:00:00Z", "2028-03-08T12:00:00Z");
    expect(slots({ windows: tuesday, durationMin: 60 }).map((s) => local(s))).toEqual(["2028-02-29 10:00", "2028-03-07 10:00"]);
    const override = windows([], [{ date: "2028-02-29", start: "23:00", end: "24:00" }, { date: "2028-03-01", start: "00:00", end: "01:00" }], TOR, "2028-02-28T00:00:00Z", "2028-03-03T00:00:00Z");
    expect(slots({ windows: override, durationMin: 60, stepMin: 60 }).map((s) => local(s))).toEqual(["2028-02-29 23:00", "2028-03-01 00:00"]);
    const monthEnd = windows([{ weekday: 6, start: "23:00", end: "24:00" }, { weekday: 7, start: "00:00", end: "00:30" }], [], TOR, "2026-10-30T00:00:00Z", "2026-11-02T00:00:00Z");
    expect(slots({ windows: monthEnd, durationMin: 90, stepMin: 30 }).map((s) => local(s))).toEqual(["2026-10-31 23:00"]);
  });

  it("22. a 62-day range for one host with 400 busy blocks stays under 50 ms", () => {
    const from = T("2026-11-02T00:00:00Z");
    const to = from + 62 * D;
    const busy: Interval[] = [];
    for (let i = 0; i < 400; i++) {
      const start = from + Math.floor((i * 62 * D) / 400) + 14 * H;
      busy.push({ start, end: start + 45 * M });
    }
    const run = () => {
      const w = expandSchedule({ rules: WEEKDAYS_9_TO_5, overrides: [], tz: TOR, fromUtc: from, toUtc: to });
      return generateSlots({ windows: w, busy, durationMin: 30, stepMin: 15, bufferBeforeMin: 10, bufferAfterMin: 10, nowUtc: from, alignTz: TOR, maxAdvanceDays: 365 });
    };
    run(); // warm the formatter
    const started = performance.now();
    const starts = run();
    const elapsed = performance.now() - started;
    expect(starts.length).toBeGreaterThan(500);
    expect(elapsed).toBeLessThan(50);
  });

  it("23. encodeStarts / decodeStarts round-trip generated starts", () => {
    const w = windows(WEEKDAYS_9_TO_5, [], TOR, "2026-10-19T00:00:00Z", "2026-11-19T00:00:00Z");
    const starts = slots({ windows: w, durationMin: 45, stepMin: 15 });
    expect(decodeStarts(encodeStarts(starts))).toEqual(starts);
  });

  it("24. bad input gives typed errors: unknown zone, end before start, negative buffers", () => {
    const codes: string[] = [];
    const attempt = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        expect(error).toBeInstanceOf(SlotInputError);
        codes.push((error as SlotInputError).code);
      }
    };
    attempt(() => expandSchedule({ rules: [], overrides: [], tz: "Europe/Atlantis", fromUtc: 0, toUtc: 1 }));
    attempt(() => expandSchedule({ rules: [{ weekday: 1, start: "17:00", end: "09:00" }], overrides: [], tz: TOR, fromUtc: 0, toUtc: D }));
    attempt(() => generateSlots({ windows: [], busy: [], durationMin: 30, bufferBeforeMin: -5, nowUtc: 0, alignTz: TOR }));
    attempt(() => generateSlots({ windows: [], busy: [], durationMin: 0, nowUtc: 0, alignTz: TOR }));
    attempt(() => expandSchedule({ rules: [{ weekday: 8, start: "09:00", end: "10:00" }], overrides: [], tz: TOR, fromUtc: 0, toUtc: D }));
    expect(codes).toEqual(["unknown_time_zone", "end_before_start", "invalid_buffer", "invalid_duration", "invalid_weekday"]);
  });

  it("25. the same input gives byte-identical output (no hidden clock)", () => {
    const input: SlotInput = {
      windows: windows(WEEKDAYS_9_TO_5, [], TOR, "2026-10-19T00:00:00Z", "2026-11-19T00:00:00Z"),
      busy: [{ start: T("2026-10-20T14:00:00Z"), end: T("2026-10-20T15:00:00Z") }],
      durationMin: 45,
      stepMin: 15,
      bufferBeforeMin: 5,
      bufferAfterMin: 10,
      minNoticeMin: 120,
      maxAdvanceDays: 20,
      nowUtc: T("2026-10-19T12:00:00Z"),
      alignTz: TOR,
    };
    expect(JSON.stringify(generateSlots(input))).toBe(JSON.stringify(generateSlots({ ...input })));
  });

  it("caps a host's bookings per local day when a daily capacity is set", () => {
    const w = windows(WEEKDAYS_9_TO_5, [], TOR, "2026-10-19T00:00:00Z", "2026-10-21T04:00:00Z");
    const starts = slots({ windows: w, durationMin: 60, maxPerDay: 2, dayCounts: { "2026-10-19": 2, "2026-10-20": 1 } });
    expect(starts.some((s) => utcToLocal(s, TOR).date === "2026-10-19")).toBe(false);
    expect(starts.some((s) => utcToLocal(s, TOR).date === "2026-10-20")).toBe(true);
  });

  it("re-checks one start server side the same way it was offered", () => {
    const input: SlotInput = {
      windows: windows(WEEKDAYS_9_TO_5, [], TOR, "2026-10-19T00:00:00Z", "2026-10-21T00:00:00Z"),
      busy: [],
      durationMin: 30,
      nowUtc: T("2026-10-19T12:00:00Z"),
      alignTz: TOR,
    };
    expect(isOfferedStart(input, T("2026-10-19T14:00:00Z"))).toBe(true);
    expect(isOfferedStart(input, T("2026-10-19T14:10:00Z"))).toBe(false);
    expect(isOfferedStart(input, T("2026-10-19T22:00:00Z"))).toBe(false);
  });

  it("26. property: every generated slot fits a window and misses all padded busy intervals", () => {
    const base = T("2026-10-05T00:00:00Z");
    fc.assert(
      fc.property(
        fc.array(fc.record({ weekday: fc.integer({ min: 1, max: 7 }), from: fc.integer({ min: 0, max: 95 }), len: fc.integer({ min: 1, max: 48 }) }), { maxLength: 6 }),
        fc.array(fc.record({ at: fc.integer({ min: 0, max: 14 * 96 }), len: fc.integer({ min: 1, max: 16 }) }), { maxLength: 20 }),
        fc.constantFrom(15, 30, 45, 60),
        fc.option(fc.constantFrom(5, 15, 30), { nil: null }),
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 30 }),
        fc.constantFrom("America/Toronto", "Asia/Kolkata", "Asia/Kathmandu", "Europe/London", "UTC"),
        (ruleSpecs, busySpecs, duration, step, before, after, tz) => {
          const q = (n: number) => `${String(Math.floor(n / 4)).padStart(2, "0")}:${String((n % 4) * 15).padStart(2, "0")}`;
          const rules = ruleSpecs.map((r) => ({ weekday: r.weekday, start: q(r.from), end: q(Math.min(96, r.from + r.len)) }));
          const w = expandSchedule({ rules, overrides: [], tz, fromUtc: base, toUtc: base + 14 * D });
          const busy = busySpecs.map((b) => ({ start: base + b.at * 15 * M, end: base + (b.at + b.len) * 15 * M }));
          const starts = generateSlots({ windows: w, busy, durationMin: duration, stepMin: step, bufferBeforeMin: before, bufferAfterMin: after, nowUtc: base, alignTz: tz });
          const mergedWindows = merge(w);
          const mergedBusy = merge(busy);
          for (const s of starts) {
            if (!insideAny(mergedWindows, s, s + duration * M)) return false;
            if (overlapsAny(mergedBusy, s - before * M, s + (duration + after) * M)) return false;
          }
          return starts.every((s, i) => i === 0 || s > starts[i - 1]);
        },
      ),
      { numRuns: 150, seed: 20261018 },
    );
  });
});
