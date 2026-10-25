/**
 * The letter guard (src/modules/vo/letter-guard.ts, AI-01): a fee, date or program requirement
 * stays in a Vo letter only with an approved official source ([S#]) the run handed out (a date or
 * duration may instead come from an approved fact [F#]); anything else is left out and the draft
 * says so. Markers the run never handed out are removed; the letter must cite an approved fact.
 */
import { describe, expect, it } from "vitest";
import { guardLetter } from "@/modules/vo/letter-guard";
import { citationsIn, factText, isLetterType, letterDbError, letterFileName, stripCitations } from "@/modules/vo/letter";

const refs = { facts: ["F1", "F2"], official: ["S1"] };

describe("guardLetter", () => {
  it("keeps cited facts and a fee cited to approved official content", () => {
    const out = guardLetter("Dear officer,\n\nMy client Synthetic Applicant [F1] arrived on 2026-03-02 [F2]. The fee of CAD 12.34 was paid [S1].\n\nYours sincerely", refs);
    expect(out.kind).toBe("draft");
    if (out.kind !== "draft") return;
    expect(out.text).toContain("CAD 12.34 was paid [S1].");
    expect(out.facts).toEqual(["F1", "F2"]);
    expect(out.official).toEqual(["S1"]);
    expect(out.leftOut).toEqual([]);
  });

  it("leaves out a fee, a processing time or a requirement without an approved source, and says so", () => {
    const out = guardLetter(
      "My client Synthetic Applicant [F1] applies. The processing fee is $150 [F1]. Processing takes 6 months. Applicants are required to show funds. A biometrics deadline applies.",
      refs,
    );
    expect(out.kind).toBe("draft");
    if (out.kind !== "draft") return;
    expect(out.text).toBe("My client Synthetic Applicant [F1] applies.");
    expect(out.leftOut).toHaveLength(4);
    expect(out.leftOut.join(" ")).not.toMatch(/\$150|6 months/);
    expect(out.leftOut[0]).toMatch(/^Left out \(no approved official source or approved fact covers it\)/);
  });

  it("removes markers the run never handed out, so an invented citation can't carry a claim", () => {
    const out = guardLetter("Synthetic Applicant [F1] [F9]. The fee is CAD 99 [S7].", refs);
    expect(out.kind).toBe("draft");
    if (out.kind !== "draft") return;
    expect(out.text).toBe("Synthetic Applicant [F1].");
    expect(citationsIn(out.text)).toEqual(["F1"]);
    expect(out.leftOut).toHaveLength(1);
  });

  it("drops Vo's own placeholders, links, email addresses and phone numbers", () => {
    const out = guardLetter("Synthetic Applicant [F1] lives here. The fee is [needs a sourced rule]. Write to evil@example.com or https://evil.example/pay or +1 555 010 9999.", refs);
    expect(out.kind).toBe("draft");
    if (out.kind !== "draft") return;
    expect(out.text).toBe("Synthetic Applicant [F1] lives here.");
    expect(out.text).not.toMatch(/evil|555|needs a sourced rule/);
  });

  it("refuses a letter that cites no approved fact, and abstains like Vo's other tasks", () => {
    expect(guardLetter("Dear officer, please accept this application.", refs)).toEqual({ kind: "empty", reason: "no_fact" });
    expect(guardLetter("[needs a consultant]", refs)).toEqual({ kind: "abstain" });
    expect(guardLetter(42, refs)).toEqual({ kind: "empty", reason: "empty" });
  });

  it("keeps the model's own left-out notes as plain lines without amounts", () => {
    const out = guardLetter("Synthetic Applicant [F1].", refs, ["The study permit fee of $150 has no approved source", 7]);
    expect(out.kind === "draft" && out.leftOut).toEqual(["Left out: The study permit fee of an amount has no approved source"]);
  });
});

describe("letter helpers", () => {
  it("strips citation markers for the released text, names the file and reads facts as intake does", () => {
    expect(stripCitations("Synthetic Applicant [F1] paid CAD 12.34 [S1].\nThanks [F2]")).toBe("Synthetic Applicant paid CAD 12.34.\nThanks");
    expect(letterFileName("Cover letter: Synthetic / v2", 3)).toBe("Cover-letter-Synthetic-v2-v3.txt");
    expect(factText("country", "FR")).toBe("France");
    expect(factText("choice", "yes")).toBe("Yes");
    expect(isLetterType("cover_letter")).toBe(true);
    expect(isLetterType("contract")).toBe(false);
    expect(letterDbError("you entered this yourself, so another licensed member of the firm approves it")).toMatch(/another licensed member/);
  });
});
