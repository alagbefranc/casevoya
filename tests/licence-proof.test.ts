import { describe, expect, it } from "vitest";
import { licenceProofKey, licenceProofLocator, licenceProofType, ownLicenceProofKey, proofDisplayName } from "@/modules/firm-onboarding/licence-proof";

const ORG = "11111111-1111-4111-8111-111111111111";
const MEM = "22222222-2222-4222-8222-222222222222";
const FILE = "33333333-3333-4333-8333-333333333333";
const bytes = (...head: number[]) => Uint8Array.from([...head, ...new Array(16).fill(0)]);

describe("licence proof files", () => {
  it("accepts PDF, JPEG and PNG by their bytes and nothing else", () => {
    expect(licenceProofType(bytes(0x25, 0x50, 0x44, 0x46))).toBe("application/pdf");
    expect(licenceProofType(bytes(0xff, 0xd8, 0xff))).toBe("image/jpeg");
    expect(licenceProofType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(licenceProofType(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull();
    expect(licenceProofType(new TextEncoder().encode("<html>not a licence</html>"))).toBeNull();
  });

  it("accepts only this membership's own stored proof as a locator", () => {
    const locator = licenceProofLocator(licenceProofKey(ORG, MEM, FILE, "application/pdf"));
    expect(ownLicenceProofKey(locator, ORG, MEM)).toBe(`${ORG}/${MEM}/${FILE}.pdf`);
    expect(ownLicenceProofKey(locator, ORG, "44444444-4444-4444-8444-444444444444")).toBeNull();
    expect(ownLicenceProofKey("CICC register entry.pdf", ORG, MEM)).toBeNull();
    expect(ownLicenceProofKey(`licence-proofs/${ORG}/${MEM}/../x.pdf`, ORG, MEM)).toBeNull();
  });

  it("keeps a clean display name", () => {
    expect(proofDisplayName("C:\\Users\\me\\register.pdf")).toBe("register.pdf");
    expect(proofDisplayName("a\u0000b.png")).toBe("ab.png");
    expect(proofDisplayName("")).toBe("Licence proof");
  });
});
