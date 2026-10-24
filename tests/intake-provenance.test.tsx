import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatterIntake } from "@/components/sheet/designer/matter-intake";
import type { AnswerVersion } from "@/modules/intake/present";
import type { IntakeField } from "@/modules/sheet/intake-builder-present";
import { intakePanel, rawText } from "@/modules/sheet/matter-intake-present";

// INT-04 (#177): each answer's provenance on the matter's Intake tab. Synthetic records only.

const FIELDS: IntakeField[] = [{ key: "full_name", label: "Full name", type: "text", required: true } as IntakeField];

const version = (id: string, text: string, at: string, by: string): AnswerVersion => ({ id, fieldKey: "full_name", presence: "provided", value: { text }, raw: { text: ` ${text} ` }, createdAt: at, createdBy: by });

const names: Record<string, string> = { "u-client": "Casey Client", "u-staff": "Dana Staff" };
const who = (id: string | null) => (id ? names[id] ?? "Someone" : "Someone");

describe("answer provenance", () => {
  const input = {
    id: "r1",
    personName: "Casey Client",
    title: "Background",
    versionNumber: 2,
    status: "submitted" as const,
    submittedAt: "2026-10-14T09:00:00Z",
    frozenAt: null,
    fields: FIELDS,
    answers: [version("a1", "Casey Clint", "2026-10-13T08:00:00Z", "u-client"), version("a2", "Casey Client", "2026-10-15T14:05:00Z", "u-client")],
    reviewed: new Set(["a2"]),
    corrections: [{ number: 3, fieldKey: "full_name", answerId: "a2", description: null, createdAt: "2026-10-15T14:05:00Z" }],
    record: null,
    documents: [],
    otherBirths: [],
    reviews: new Map([["a2", { by: "u-staff", at: "2026-10-16T10:00:00Z" }]]),
    proofHref: (id: string) => (id === "a2" ? "/sheet/matters/m1?tab=documents" : null),
  };

  it("names the raw and normalised value, source, who and when, review, and what it replaced", () => {
    const panel = intakePanel(input, who, "UTC", "2026-10-19");
    expect(panel.rows[0].provenance).toEqual({
      raw: " Casey Client ",
      normalized: "Casey Client",
      source: "Correction CR-0003 to Background v2",
      sourceHref: "/sheet/matters/m1?tab=documents",
      by: "Casey Client",
      at: "15 Oct 14:05",
      review: "Reviewed by Dana Staff, 16 Oct 10:00",
      earlier: [{ value: "Casey Clint", by: "Casey Client", at: "13 Oct 08:00" }],
    });
  });

  it("is left out where the loader gives no review data (the Designer's page)", () => {
    expect(intakePanel({ ...input, reviews: undefined }, who, "UTC", "2026-10-19").rows[0].provenance).toBeNull();
    expect(rawText(undefined)).toBe("Nothing entered");
    expect(rawText({ entries: [1, 2] })).toBe('{"entries":[1,2]}');
  });

  it("renders as Provenance details in the answer's Source cell", () => {
    const panel = intakePanel(input, who, "UTC", "2026-10-19");
    const html = renderToStaticMarkup(createElement(MatterIntake, { data: { organizationId: "o1", panels: [panel], reviewer: true, send: null, note: "" } as never }));
    expect(html).toContain('<details class="prov"><summary>Provenance</summary>');
    expect(html).toContain("<dt>Raw value</dt><dd> Casey Client </dd>");
    expect(html).toContain('href="/sheet/matters/m1?tab=documents">Correction CR-0003 to Background v2 (proof document)</a>');
    expect(html).toContain("<li>Casey Clint (Casey Client, 13 Oct 08:00)</li>");
  });
});
