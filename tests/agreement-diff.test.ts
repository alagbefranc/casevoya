import { describe, expect, it } from "vitest";
import { diffParagraphs, diffTexts, diffWords, hasChanges } from "@/modules/agreements/diff";

function join(tokens: { kind: string; text: string }[], keep: string[]): string {
  return tokens
    .filter((token) => keep.includes(token.kind))
    .map((token) => token.text)
    .join("");
}

describe("agreement text diff", () => {
  it("splits words with their trailing whitespace", () => {
    expect(diffWords("CAD 2,600.00, plus\nHST.")).toEqual(["CAD ", "2,600.00, ", "plus\n", "HST."]);
    expect(diffWords("")).toEqual([]);
  });

  it("marks a changed fee as removed then added, keeping the rest", () => {
    const before = "Professional fee for the work permit application: CAD 2,600.00, plus HST.";
    const after = "Professional fee for the work permit application: CAD 2,900.00, plus HST.";
    const tokens = diffTexts(before, after);
    expect(tokens).toEqual([
      { kind: "same", text: "Professional fee for the work permit application: CAD " },
      { kind: "del", text: "2,600.00, " },
      { kind: "ins", text: "2,900.00, " },
      { kind: "same", text: "plus HST." },
    ]);
    expect(join(tokens, ["same", "del"])).toBe(before);
    expect(join(tokens, ["same", "ins"])).toBe(after);
    expect(hasChanges(tokens)).toBe(true);
  });

  it("round-trips any pair of texts, including empty and identical ones", () => {
    const cases: [string, string][] = [
      ["", ""],
      ["", "Added text here."],
      ["Removed text here.", ""],
      ["one two three", "one two three"],
      ["Paid as one invoice after submission.", "Paid as two milestones: package released and decision recorded."],
      ["a b c d e f g", "g f e d c b a"],
      ["## Fees\nCAD 100 due.\n\n## Scope\nAll of it.", "## Fees\nCAD 200 due.\n\n## Scope\nAll of it, and more."],
    ];
    for (const [before, after] of cases) {
      const tokens = diffTexts(before, after);
      expect(join(tokens, ["same", "del"])).toBe(before);
      expect(join(tokens, ["same", "ins"])).toBe(after);
      expect(hasChanges(tokens)).toBe(before !== after);
    }
  });

  it("stays fast on long texts", () => {
    const words = Array.from({ length: 3000 }, (_, index) => `w${index}`);
    const before = words.join(" ");
    const after = [...words.slice(0, 1500), "changed", ...words.slice(1501)].join(" ");
    const started = Date.now();
    const tokens = diffTexts(before, after);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(tokens.filter((token) => token.kind === "del")).toEqual([{ kind: "del", text: "w1500 " }]);
    expect(tokens.filter((token) => token.kind === "ins")).toEqual([{ kind: "ins", text: "changed " }]);
  });

  it("renders paragraphs the Designer way: one list per blank-line block, kinds kept", () => {
    const tokens = diffTexts("Fee: CAD 100.\n\nPaid as one invoice.", "Fee: CAD 200.\n\nPaid as two milestones.");
    const paragraphs = diffParagraphs(tokens);
    expect(paragraphs).toEqual([
      [
        { kind: "same", text: "Fee: CAD " },
        { kind: "del", text: "100." },
        { kind: "ins", text: "200." },
      ],
      [
        { kind: "same", text: "Paid as " },
        { kind: "del", text: "one invoice." },
        { kind: "ins", text: "two milestones." },
      ],
    ]);
    expect(diffParagraphs(diffTexts("", ""))).toEqual([]);
  });
});
