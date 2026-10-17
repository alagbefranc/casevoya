import { describe, expect, it } from "vitest";
import { totp } from "../scripts/ops/totp.mjs";

// RFC 6238 appendix B, SHA-1 secret "12345678901234567890", last six digits.
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("ops TOTP helper", () => {
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("matches the RFC vector at %i seconds", (seconds, code) => {
    expect(totp(SECRET, seconds * 1000)).toBe(code);
  });
});
