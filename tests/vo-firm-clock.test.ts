/** Vo is given the firm's own clock, so "tomorrow at 10am" lands on the firm's tomorrow (not UTC's). */
import { describe, expect, it } from "vitest";
import { connectedCatalogue, firmClock } from "../services/vo-agent/src/connected-tools";

describe("firmClock", () => {
  // 00:44 UTC on Nov 1 is still the evening of Oct 31 in Winnipeg and Edmonton.
  const now = new Date("2026-11-01T00:44:00Z");

  it("states the firm's local date, time, zone and offset, and says to resolve dates there", () => {
    const text = firmClock("America/Winnipeg", now);
    expect(text).toContain("Saturday 2026-10-31 19:44 (America/Winnipeg, UTC-05:00)");
    expect(text).toMatch(/never in UTC/);
    expect(text).toContain('timezone argument (if it has one) to "America/Winnipeg"');
    expect(firmClock("America/Edmonton", now)).toContain("Saturday 2026-10-31 18:44 (America/Edmonton, UTC-06:00)");
  });

  it("falls back to America/Toronto for a missing or unknown zone", () => {
    expect(firmClock(null, now)).toContain("(America/Toronto, UTC-04:00)");
    expect(firmClock("Not/AZone", now)).toContain("(America/Toronto,");
  });

  it("leads the connected-apps catalogue Vo sees", () => {
    const text = connectedCatalogue({ membershipId: "m", active: [], timeZone: "America/Winnipeg" }, now);
    expect(text.split("\n")[0]).toContain("2026-10-31 19:44");
    expect(text).toContain('app "zoom"');
  });
});
