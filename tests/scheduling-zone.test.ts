import { describe, expect, it } from "vitest";
import { SlotInputError, addDays, assertTimeZone, localToUtc, offsetMinutes, utcToLocal, weekdayOf } from "@/modules/scheduling/slots";

const iso = (ms: number) => new Date(ms).toISOString();

describe("slot library: zone", () => {
  it("reads the offset in force at an instant", () => {
    expect(offsetMinutes(Date.parse("2026-07-01T12:00:00Z"), "America/Toronto")).toBe(-240);
    expect(offsetMinutes(Date.parse("2026-12-01T12:00:00Z"), "America/Toronto")).toBe(-300);
    expect(offsetMinutes(Date.parse("2026-12-01T12:00:00Z"), "Asia/Kolkata")).toBe(330);
    expect(offsetMinutes(Date.parse("2026-12-01T12:00:00Z"), "Asia/Kathmandu")).toBe(345);
    expect(offsetMinutes(Date.parse("2026-12-01T12:00:00Z"), "UTC")).toBe(0);
  });

  it("turns local wall time into UTC on both sides of DST", () => {
    expect(iso(localToUtc("2026-10-19", "09:00", "America/Toronto"))).toBe("2026-10-19T13:00:00.000Z");
    expect(iso(localToUtc("2026-11-02", "09:00", "America/Toronto"))).toBe("2026-11-02T14:00:00.000Z");
    expect(iso(localToUtc("2026-10-19", "24:00", "America/Toronto"))).toBe("2026-10-20T04:00:00.000Z");
  });

  it("moves a skipped wall time forward and takes the earlier of a repeated one", () => {
    // 8 Mar 2026: 02:00 EST jumps to 03:00 EDT.
    expect(iso(localToUtc("2026-03-08", "02:30", "America/Toronto", { gap: "forward" }))).toBe("2026-03-08T07:30:00.000Z");
    expect(utcToLocal(localToUtc("2026-03-08", "02:30", "America/Toronto"), "America/Toronto").time).toBe("03:30");
    // 1 Nov 2026: 01:30 happens at 05:30Z (EDT) and again at 06:30Z (EST).
    expect(iso(localToUtc("2026-11-01", "01:30", "America/Toronto", { overlap: "earlier" }))).toBe("2026-11-01T05:30:00.000Z");
    expect(iso(localToUtc("2026-11-01", "01:30", "America/Toronto", { overlap: "later" }))).toBe("2026-11-01T06:30:00.000Z");
  });

  it("reads local date, time and ISO weekday", () => {
    const local = utcToLocal(Date.parse("2026-10-19T03:30:00Z"), "America/Vancouver");
    expect(local).toEqual({ date: "2026-10-18", time: "20:30", weekday: 7, minuteOfDay: 20 * 60 + 30 });
    expect(weekdayOf("2026-10-19")).toBe(1);
    expect(weekdayOf("2028-02-29")).toBe(2);
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });

  it("refuses an unknown zone, a bad date and a bad time with typed errors", () => {
    expect(() => assertTimeZone("Mars/Olympus_Mons")).toThrow(SlotInputError);
    expect(() => localToUtc("2026-02-30", "09:00", "UTC")).toThrow(/Not a date/);
    expect(() => localToUtc("2026-02-10", "25:00", "UTC")).toThrow(/Not a time/);
    try {
      assertTimeZone("Nowhere/Land");
    } catch (error) {
      expect((error as SlotInputError).code).toBe("unknown_time_zone");
    }
  });
});
