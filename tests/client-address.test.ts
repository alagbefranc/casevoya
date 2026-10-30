import { describe, expect, it } from "vitest";
import { clientAddress, clientIp, isIpAddress } from "@/lib/security/client-address";

const h = (init: Record<string, string>) => new Headers(init);

describe("client address for evidence", () => {
  it("prefers cf-connecting-ip over headers the client can write", () => {
    const headers = h({ "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.99, 10.0.0.1", "x-real-ip": "203.0.113.98" });
    expect(clientAddress(headers)).toBe("198.51.100.7");
    expect(clientIp(headers)).toBe("198.51.100.7");
  });

  it("falls back to x-real-ip, then the first x-forwarded-for entry, only without cf-connecting-ip", () => {
    expect(clientIp(h({ "x-real-ip": "203.0.113.5", "x-forwarded-for": "203.0.113.6" }))).toBe("203.0.113.5");
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.6, 10.0.0.1" }))).toBe("203.0.113.6");
    expect(clientIp(h({ "cf-connecting-ip": "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it("uses the fallback for a missing or malformed address", () => {
    expect(clientIp(h({}))).toBe("127.0.0.1");
    expect(clientIp(h({ "cf-connecting-ip": "not-an-ip" }))).toBe("127.0.0.1");
    expect(clientIp(h({ "x-forwarded-for": "999.1.1.1" }))).toBe("127.0.0.1");
    expect(isIpAddress(":::")).toBe(false);
    expect(isIpAddress("1:2")).toBe(false);
    expect(isIpAddress("::ffff:192.0.2.1")).toBe(true);
  });
});
