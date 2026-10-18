import { describe, expect, it } from "vitest";
import {
  brandingLogoLocator,
  firmLogoKey,
  firmLogoLocator,
  firmLogoType,
  ownFirmLogoKey,
} from "@/modules/firm-onboarding/firm-logo";

const ORG = "11111111-1111-4111-8111-111111111111";
const FILE = "33333333-3333-4333-8333-333333333333";
const bytes = (...head: number[]) => Uint8Array.from([...head, ...new Array(16).fill(0)]);

describe("firm logo files", () => {
  it("accepts PNG and JPEG by their bytes and nothing else", () => {
    expect(firmLogoType(bytes(0xff, 0xd8, 0xff))).toBe("image/jpeg");
    expect(firmLogoType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(firmLogoType(bytes(0x25, 0x50, 0x44, 0x46))).toBeNull();
    expect(firmLogoType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>'))).toBeNull();
    expect(firmLogoType(new TextEncoder().encode("<html>not a logo</html>"))).toBeNull();
  });

  it("accepts only this firm's own stored logo as a locator", () => {
    const locator = firmLogoLocator(firmLogoKey(ORG, FILE, "image/png"));
    expect(locator).toBe(`firm-logos/${ORG}/${FILE}.png`);
    expect(ownFirmLogoKey(locator, ORG)).toBe(`${ORG}/${FILE}.png`);
    expect(ownFirmLogoKey(locator, "44444444-4444-4444-8444-444444444444")).toBeNull();
    expect(ownFirmLogoKey(`firm-logos/${ORG}/../x.png`, ORG)).toBeNull();
    expect(ownFirmLogoKey(`firm-logos/${ORG}/${FILE}.svg`, ORG)).toBeNull();
    expect(ownFirmLogoKey(`licence-proofs/${ORG}/${FILE}.png`, ORG)).toBeNull();
    expect(ownFirmLogoKey(locator, ".*")).toBeNull();
  });

  it("reads the saved locator from organizations.branding", () => {
    expect(brandingLogoLocator({ logo_locator: " firm-logos/a.png ", accent: "#0075DE" })).toBe("firm-logos/a.png");
    expect(brandingLogoLocator({ accent: "#0075DE" })).toBeNull();
    expect(brandingLogoLocator({ logo_locator: 5 })).toBeNull();
    expect(brandingLogoLocator(null)).toBeNull();
    expect(brandingLogoLocator(["x"])).toBeNull();
  });
});
