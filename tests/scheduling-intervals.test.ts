import { describe, expect, it } from "vitest";
import { insideAny, intersect, merge, overlapsAny, pad, subtract } from "@/modules/scheduling/slots";

const I = (start: number, end: number) => ({ start, end });

describe("slot library: intervals", () => {
  it("merges overlapping and touching intervals and drops empty ones", () => {
    expect(merge([I(5, 7), I(1, 3), I(3, 4), I(6, 9), I(10, 10)])).toEqual([I(1, 4), I(5, 9)]);
    expect(merge([])).toEqual([]);
  });

  it("subtracts cuts, leaving touching edges in place (half-open)", () => {
    expect(subtract([I(0, 10)], [I(2, 4), I(6, 7)])).toEqual([I(0, 2), I(4, 6), I(7, 10)]);
    expect(subtract([I(0, 10)], [I(10, 12)])).toEqual([I(0, 10)]);
    expect(subtract([I(0, 10)], [I(-5, 15)])).toEqual([]);
    expect(subtract([I(0, 5), I(8, 12)], [I(4, 9)])).toEqual([I(0, 4), I(9, 12)]);
  });

  it("intersects two sets", () => {
    expect(intersect([I(0, 5), I(8, 12)], [I(3, 9)])).toEqual([I(3, 5), I(8, 9)]);
    expect(intersect([I(0, 5)], [I(5, 9)])).toEqual([]);
  });

  it("pads by minutes on each side", () => {
    expect(pad(I(600_000, 1_200_000), 5, 10)).toEqual(I(300_000, 1_800_000));
  });

  it("answers overlap and containment against a sorted list", () => {
    const list = merge([I(10, 20), I(30, 40)]);
    expect(overlapsAny(list, 0, 10)).toBe(false);
    expect(overlapsAny(list, 20, 30)).toBe(false);
    expect(overlapsAny(list, 19, 21)).toBe(true);
    expect(insideAny(list, 30, 40)).toBe(true);
    expect(insideAny(list, 15, 31)).toBe(false);
  });
});
