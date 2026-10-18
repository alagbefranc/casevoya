import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { FOOTER_NOTICE, renderAgreementPdf, renderCertificatePdf } from "@/modules/agreements/pdf-render";
import { formatInZone, formatMoney, formatUtc, paragraphs, pdfSafeText, wrapText } from "@/modules/agreements/pdf-text";
import { agreementTerms } from "@/modules/agreements/seal-source";
import { SAMPLE_BODY, sampleLogo, sampleSource } from "./fixtures/agreement-seal-fixture";
import { pdfText } from "./helpers/pdf-text";

const measure = (value: string) => value.length * 5;

describe("PDF text", () => {
  it("keeps French accents and typography in WinAnsi and transliterates the rest", () => {
    expect(pdfSafeText("Été, façade, œuvre, « garantie » — 1 500 € ; naïve, Ÿ")).toBe(
      "Été, façade, œuvre, « garantie » — 1 500 € ; naïve, Ÿ",
    );
    expect(pdfSafeText("Ștefan Țurcanu → 2‑step")).toBe("Stefan Turcanu -> 2-step");
    expect(pdfSafeText("北京 🙂")).toBe("?? ?");
    expect(pdfSafeText("line one\nline two​")).toBe("line one line two");
    expect(pdfSafeText(null)).toBe("");
  });

  it("wraps between words, never mid-word, and breaks only an over-long token", () => {
    const text = "The firm will prepare and submit a spousal sponsorship application for the client";
    const lines = wrapText(text, 120, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe(text);
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(120);
    const hash = "a".repeat(64);
    const broken = wrapText(`SHA ${hash}`, 100, measure);
    expect(broken[0]).toBe("SHA");
    expect(broken.slice(1).join("")).toBe(hash);
    expect(wrapText("   ", 100, measure)).toEqual([""]);
  });

  it("splits paragraphs on blank lines and keeps single line breaks", () => {
    expect(paragraphs("One\nTwo\n\n\nThree\r\n")).toEqual([["One", "Two"], ["Three"]]);
  });

  it("formats times in the firm zone and UTC, and fees without floating point", () => {
    expect(formatUtc("2026-10-18T13:10:45.731Z")).toBe("2026-10-18 13:10:45 UTC");
    expect(formatInZone("2026-10-18T13:10:45.731Z", "America/Toronto")).toBe("18 October 2026, 09:10:45 EDT");
    expect(formatInZone("2026-10-18T13:10:45.731Z", "Not/AZone")).toBe("18 October 2026, 13:10:45 UTC");
    expect(formatMoney("350000", "CAD")).toBe("CAD 3,500.00");
    expect(formatMoney("5", "EUR")).toBe("EUR 0.05");
    expect(formatMoney(null, "CAD")).toBeNull();
  });
});

describe("sealed agreement PDF", () => {
  it("separates the terms from the canonical fields exactly", () => {
    const source = sampleSource();
    expect(agreementTerms(source)).toEqual({ terms: SAMPLE_BODY, exact: true });
  });

  it("lays out firm, parties, fees, terms and signatures with a footer on every page", async () => {
    const source = sampleSource();
    const bytes = await renderAgreementPdf(source, sampleLogo());
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    const pages = doc.getPageCount();
    const text = pdfText(bytes);
    for (const expected of [
      "Maple & Rivière Immigration",
      "Maple & Rivière Immigration Conseil Inc.",
      "Service agreement — spousal sponsorship",
      "Matter MRI-2026-0042",
      "Amélie Dubois-Lefèvre",
      "Sponsor",
      "CAD 3,500.00",
      "REFUND POLICY",
      "« noir sur blanc ».",
      "Signed electronically 17 October 2026, 11:02:11 EDT (2026-10-17 15:02:11 UTC)",
      "Electronic signature consent: esign-consent-2026-10-17",
      FOOTER_NOTICE,
      `Content SHA-256 ${source.envelope.contentSha256}`,
      `Page ${pages} of ${pages}`,
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain("?CAD?");
    expect(doc.getTitle()).toBe(source.agreement.title);
  });

  it("flows a long agreement over many pages, numbering each and repeating the hash", async () => {
    const long = Array.from({ length: 80 }, (_, index) =>
      `Clause ${index + 1}. Le client reconnaît que les délais de traitement sont fixés par IRCC et peuvent changer sans préavis; the firm will keep the client informed in writing.`,
    ).join("\n\n");
    const source = sampleSource({ body: long });
    const bytes = await renderAgreementPdf(source);
    const doc = await PDFDocument.load(bytes);
    const pages = doc.getPageCount();
    expect(pages).toBeGreaterThan(3);
    const text = pdfText(bytes);
    for (let page = 1; page <= pages; page += 1) expect(text).toContain(`Page ${page} of ${pages}`);
    expect(text.split(`Content SHA-256 ${source.envelope.contentSha256}`).length - 1).toBe(pages);
    expect(text.split(FOOTER_NOTICE).length - 1).toBe(pages);
    expect(text).toContain("Clause 80.");
    expect(text).toContain("reconnaît que les délais");
  });

  it("refuses to render text that does not match the signed content hash", async () => {
    const source = sampleSource();
    source.version.canonicalBody = `${source.version.canonicalBody} (edited)`;
    await expect(renderAgreementPdf(source)).rejects.toThrow(/content hash/);
  });

  it("renders the same bytes for the same envelope", async () => {
    const one = await renderAgreementPdf(sampleSource(), sampleLogo());
    const two = await renderAgreementPdf(sampleSource(), sampleLogo());
    expect(createHash("sha256").update(one).digest("hex")).toBe(createHash("sha256").update(two).digest("hex"));
  });
});

describe("completion certificate", () => {
  it("lists the hashes, each signer's evidence, consent and the event history", async () => {
    const source = sampleSource();
    const agreement = await renderAgreementPdf(source);
    const sealed = createHash("sha256").update(agreement).digest("hex");
    const bytes = await renderCertificatePdf(source, sealed);
    const text = pdfText(bytes);
    for (const expected of [
      "Completion certificate",
      source.envelope.id,
      source.envelope.contentSha256,
      sealed,
      "203.0.113.24",
      "198.51.100.77",
      "Josée Tremblay, RCIC R512345",
      "Consent: esign-consent-2026-10-17",
      "Sent for signature",
      "Completed",
      "2026-10-18 13:10:45 UTC",
      FOOTER_NOTICE,
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).toContain("Mozilla/5.0");
    await expect(renderCertificatePdf(source, "nothex")).rejects.toThrow(/malformed/);
  });

  // WRITE_AGREEMENT_SAMPLES=1 pnpm vitest run tests/agreement-pdf-render.test.ts
  it.runIf(process.env.WRITE_AGREEMENT_SAMPLES === "1")("writes the review samples to docs/samples", async () => {
    const source = sampleSource();
    const logo = sampleLogo();
    const agreement = await renderAgreementPdf(source, logo);
    const sealed = createHash("sha256").update(agreement).digest("hex");
    const certificate = await renderCertificatePdf(source, sealed, logo);
    const dir = path.resolve(import.meta.dirname, "../docs/samples");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "agreement-sample.pdf"), agreement);
    writeFileSync(path.join(dir, "certificate-sample.pdf"), certificate);
  });
});
