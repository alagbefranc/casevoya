import { describe, expect, it } from "vitest";
import { fieldStatus, mapTemplateFields, staleLabel } from "@/modules/prep/mapping";
import { bundleFileName, channelPatternOk, DEFAULT_BUNDLE_PATTERN } from "@/modules/prep/channel-name";
import { parseFieldLines } from "@/modules/prep/fields";
import { planBundle, renderEvidenceBundle } from "@/modules/prep/bundle-pdf";
import { PDFDocument, StandardFonts } from "pdf-lib";

describe("form field mapping", () => {
  const facts = [
    { answerId: "a", personName: "Synthetic Applicant", label: "Full name", valueText: "Synthetic Applicant", reviewedAt: "2026-10-29T00:00:00Z", fieldKey: "full_name" },
    { answerId: "b", personName: "Synthetic Sponsor", label: "Full name", valueText: "Synthetic Sponsor", reviewedAt: "2026-10-29T00:00:00Z", fieldKey: "full_name" },
  ];

  it("marks a mapped field filled from every matching fact, and an unmapped field manual", () => {
    const rows = mapTemplateFields(
      [
        { fieldKey: "family_name", label: "Family name", required: true, factFieldKey: "full_name" },
        { fieldKey: "uci", label: "Client ID", required: false, factFieldKey: "uci" },
        { fieldKey: "signature", label: "Signature", required: true, factFieldKey: null },
      ],
      facts,
    );
    expect(rows.map((row) => row.status)).toEqual(["filled", "missing", "manual"]);
    expect(rows[0]?.facts.map((fact) => fact.personName)).toEqual(["Synthetic Applicant", "Synthetic Sponsor"]);
    expect(rows[2]?.facts).toEqual([]);
    expect(fieldStatus(null, 3)).toBe("manual");
    expect(fieldStatus("uci", 0)).toBe("missing");
  });

  it("names why a form version is stale without inventing a date", () => {
    expect(staleLabel("not_current")).toMatch(/no longer the approved one/);
    expect(staleLabel("recheck_due")).toMatch(/re-check/);
    expect(staleLabel("not_yet_effective")).toMatch(/has not arrived/);
  });
});

describe("channel file names", () => {
  it("fills the product tokens and refuses a path", () => {
    expect(channelPatternOk(DEFAULT_BUNDLE_PATTERN)).toBe(true);
    expect(channelPatternOk("../secret.pdf")).toBe(false);
    expect(channelPatternOk("{reference}/{channel}.pdf")).toBe(false);
    expect(bundleFileName("{reference}-{channel}-{date}.pdf", { reference: "CV 12", channel: "Online portal", date: "2026-10-29" })).toBe(
      "CV-12-Online-portal-2026-10-29.pdf",
    );
    expect(bundleFileName("not a pattern", { reference: "CV1", channel: "paper", date: "2026-10-29" })).toBe("CV1-evidence-bundle.pdf");
  });
});

describe("field transcription", () => {
  it("reads one field per line and leaves a blank fact key as manual", () => {
    const parsed = parseFieldLines("family_name | Family name | yes | full_name\nsignature | Signature | no |\n");
    expect(parsed).toEqual({
      fields: [
        { field_key: "family_name", label: "Family name", required: true, fact_field_key: "full_name" },
        { field_key: "signature", label: "Signature", required: false, fact_field_key: null },
      ],
    });
    expect(parseFieldLines("Family name only")).toMatchObject({ error: expect.stringMatching(/key \| label/) });
  });
});

describe("evidence bundle PDF", () => {
  it("plans a cover, an index and page numbers, and leaves a non-PDF out of the page run", () => {
    const plan = planBundle([
      { fileName: "a.pdf", purpose: "Passport", included: true, pageCount: 2, reason: null },
      { fileName: "note.docx", purpose: "Letter", included: false, pageCount: 0, reason: "Kept as its own file." },
    ]);
    expect(plan.indexPages).toBe(1);
    expect(plan.totalPages).toBe(4);
    expect(plan.rows[0]).toMatchObject({ startPage: 3, endPage: 4, included: true });
    expect(plan.rows[1]).toMatchObject({ included: false, startPage: null });
  });

  it("builds one PDF with a cover, the index and the copied pages", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([200, 200]);
    const font = await source.embedFont(StandardFonts.Helvetica);
    page.drawText("synthetic", { x: 20, y: 100, size: 12, font });
    const bytes = await source.save();
    const rendered = await renderEvidenceBundle({
      firmName: "Synthetic Firm",
      matterReference: "CV-1",
      channelLabel: "Paper",
      generatedAt: "2026-10-29T12:00:00.000Z",
      maxBytes: 25 * 1024 * 1024,
      documents: [
        { fileName: "passport.pdf", purpose: "Passport", mediaType: "application/pdf", bytes },
        { fileName: "notes.docx", purpose: "Notes", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: new Uint8Array([1, 2, 3]) },
      ],
    });
    expect("pdf" in rendered).toBe(true);
    if (!("pdf" in rendered)) return;
    const doc = await PDFDocument.load(rendered.pdf);
    expect(doc.getPageCount()).toBe(rendered.plan.totalPages);
    expect(rendered.plan.totalPages).toBe(3);
    expect(doc.getTitle()).toBe("Evidence bundle");
  });

  it("refuses a bundle over the channel cap", async () => {
    const source = await PDFDocument.create();
    source.addPage();
    const bytes = await source.save();
    const rendered = await renderEvidenceBundle({
      firmName: "Synthetic Firm",
      matterReference: "CV-1",
      channelLabel: "Paper",
      generatedAt: "2026-10-29T12:00:00.000Z",
      maxBytes: 100,
      documents: [{ fileName: "passport.pdf", purpose: "Passport", mediaType: "application/pdf", bytes }],
    });
    expect(rendered).toMatchObject({ error: "over_limit", maxBytes: 100 });
  });
});
