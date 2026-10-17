import { describe, expect, it } from "vitest";
import { agreementError } from "@/modules/agreements/errors";
import { pdfBytes } from "@/modules/agreements/pdf";

describe("agreement PDF bytes", () => {
  it("accepts a PostgREST hex PDF and rejects anything else", () => {
    const hex = `\\x${Buffer.from("%PDF-1.4 synthetic").toString("hex")}`;
    const bytes = pdfBytes(hex);
    expect(bytes?.subarray(0, 4)).toEqual(new Uint8Array(Buffer.from("%PDF")));
    expect(pdfBytes("\\x68656c6c6f")).toBeNull();
    expect(pdfBytes(Buffer.from("%PDF-1.4").toString("base64"))?.subarray(0, 4)).toEqual(new Uint8Array(Buffer.from("%PDF")));
    expect(pdfBytes(null)).toBeNull();
  });
});

describe("agreement errors", () => {
  it("keeps database detail off the portal", () => {
    expect(agreementError("electronic signature consent is required")).toBe("Confirm that you agree to sign electronically.");
    expect(agreementError("it is not your turn to sign")).toBe("Someone else signs before you.");
    expect(agreementError("envelope expired")).toBe("This agreement expired. Ask your firm for a new copy.");
    expect(agreementError("relation public.signature_events")).toBe("That action could not be completed.");
  });
});
