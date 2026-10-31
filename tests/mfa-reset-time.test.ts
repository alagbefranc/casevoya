import { describe, expect, it } from "vitest";
import { firmTime } from "@/modules/auth/mfa-reset-time";

describe("firmTime", () => {
  it("shows the firm's zone, not UTC", () => {
    expect(firmTime("2026-10-31T03:39:03Z", "America/Winnipeg")).toMatch(/Oct 30, 2026, 10:39 p\.m\. CDT/);
  });
  it("falls back to Toronto for a bad zone and is empty for null", () => {
    expect(firmTime("2026-10-31T03:39:03Z", "Not/AZone")).toMatch(/11:39 p\.m\. EDT/);
    expect(firmTime(null, "America/Winnipeg")).toBe("");
  });
});
