import { describe, expect, it } from "vitest";
import { SlotInputError, decodeStarts, encodeStarts } from "@/modules/scheduling/slots";

const M = 60_000;

describe("slot library: encoding (23)", () => {
  it("round-trips starts as epoch minutes then deltas, including an empty list and large gaps", () => {
    const starts = [Date.parse("2026-10-18T14:50:00Z"), Date.parse("2026-10-18T15:00:00Z"), Date.parse("2027-03-01T09:00:00Z")];
    const encoded = encodeStarts(starts);
    expect(encoded[0]).toBe(starts[0] / M);
    expect(encoded[1]).toBe(10);
    expect(encoded[2]).toBe((starts[2] - starts[1]) / M);
    expect(decodeStarts(encoded)).toEqual(starts);
    expect(encodeStarts([])).toEqual([]);
    expect(decodeStarts([])).toEqual([]);
  });

  it("refuses unsorted, fractional or malformed input", () => {
    expect(() => encodeStarts([2 * M, M])).toThrow(SlotInputError);
    expect(() => encodeStarts([M + 1])).toThrow(SlotInputError);
    expect(() => decodeStarts([10, 0])).toThrow(SlotInputError);
    expect(() => decodeStarts([10, -1])).toThrow(SlotInputError);
    expect(() => decodeStarts("10,1")).toThrow(SlotInputError);
  });
});
