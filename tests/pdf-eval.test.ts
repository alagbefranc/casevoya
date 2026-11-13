import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("pdf.js document open", () => {
  it("refuses string evaluation when the redaction preview opens a PDF", () => {
    const source = readFileSync(path.join(process.cwd(), "src/components/documents/redact-dialog.tsx"), "utf8");
    const call = source.slice(source.indexOf("pdfjs.getDocument"));
    expect(call.startsWith("pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false })")).toBe(true);
  });
});
