import { describe, expect, it } from "vitest";
import { isFindHost } from "@/modules/find/host";
import { FIND_CONSENT_STATEMENT, FIND_NOT_SENT, findAddressHash, readFindRequest } from "@/modules/find/request";

const sample = {
  goal: "Study in Canada",
  country: "Nigeria",
  code: "NG",
  zone: "Africa/Lagos",
  language: "English",
  name: "Rohan",
  email: "rohan@example.com",
  consent: true,
};

describe("readFindRequest", () => {
  it("accepts the public payload and trims text", () => {
    expect(readFindRequest({ ...sample, name: "  Rohan  ", code: "ng" })).toEqual({
      input: { ...sample, consent: true },
    });
  });

  it("refuses consent that is not true", () => {
    expect(readFindRequest({ ...sample, consent: false })).toEqual({ error: "consent_required" });
    expect(readFindRequest({ ...sample, consent: "true" })).toEqual({ error: "consent_required" });
    expect(FIND_CONSENT_STATEMENT).toContain("one licensed consultant");
  });

  it("refuses a zone that is not one of that country's", () => {
    expect(readFindRequest({ ...sample, zone: "America/Toronto" })).toEqual({ error: "invalid" });
    const canada = readFindRequest({ ...sample, code: "CA", country: "Canada", zone: "America/Toronto" });
    expect("input" in canada && canada.input.zone).toBe("America/Toronto");
  });

  it("refuses an unfinished email, an empty name, and the language placeholder", () => {
    expect(readFindRequest({ ...sample, email: "rohan@" })).toEqual({ error: "invalid" });
    expect(readFindRequest({ ...sample, name: "  " })).toEqual({ error: "invalid" });
    expect(readFindRequest({ ...sample, language: "Another language" })).toEqual({ error: "invalid" });
    expect(readFindRequest({ ...sample, goal: "A marketplace" })).toEqual({ error: "invalid" });
  });

  it("keeps the failure sentence free of internal names", () => {
    expect(FIND_NOT_SENT.toLowerCase()).not.toContain("francis");
    expect(FIND_NOT_SENT).not.toContain("Referrals");
    expect(FIND_NOT_SENT).toMatch(/not sent/i);
  });
});

describe("findAddressHash", () => {
  it("hashes an address and shares one bucket when the address is missing", async () => {
    const headers = new Headers({ "cf-connecting-ip": "203.0.113.9" });
    const hashed = await findAddressHash(headers, "salt");
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    expect(await findAddressHash(headers, "salt")).toBe(hashed);
    expect(await findAddressHash(new Headers(), "salt")).toMatch(/^[0-9a-f]{64}$/);
    expect(await findAddressHash(new Headers(), "salt")).not.toBe(hashed);
  });
});

describe("isFindHost", () => {
  it("matches the public hostname only", () => {
    expect(isFindHost("find.casevoya.ca")).toBe(true);
    expect(isFindHost("FIND.casevoya.ca:443")).toBe(true);
    expect(isFindHost("app.casevoya.ca")).toBe(false);
    expect(isFindHost("find.casevoya.ca.evil.com")).toBe(false);
  });
});
