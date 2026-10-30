import { afterEach, describe, expect, it, vi } from "vitest";
import { REDACTED, isSensitiveHeader, redact, redactHeaders, redactText, redactedMessage } from "@/lib/log/redact";
import { provisionFirmSlug } from "@/modules/email/routing";

// Synthetic values only: shaped like real credentials so the patterns are exercised.
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEiLCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.c2lnbmF0dXJlLXZhbHVl";
const BEARER = "Bearer abcdefghijklmnop0123456789";

describe("log redaction", () => {
  afterEach(() => vi.restoreAllMocks());

  it("removes bearer tokens, JWTs, Supabase secret keys and secret query values from text", () => {
    const text = `failed ${BEARER} jwt=${JWT} sb_secret_exampleOnly123 https://x.test/object/sign/a.pdf?token=abc.def&download=1&code=xyz&key=k1#frag`;
    const out = redactText(text);
    expect(out).not.toContain("abcdefghijklmnop0123456789");
    expect(out).not.toContain(JWT);
    expect(out).not.toContain("sb_secret_exampleOnly123");
    expect(out).not.toMatch(/token=abc|code=xyz|key=k1/);
    expect(out).toContain(`token=${REDACTED}`);
    expect(out).toContain("download=1");
    expect(out).toContain("Bearer [redacted]");
    expect(out).toContain("https://x.test/object/sign/a.pdf?");
  });

  it("leaves ordinary operational text alone", () => {
    const text = "email routing failed create harbour cloudflare 500 (error code 23505, basic plan)";
    expect(redactText(text)).toBe(text);
  });

  it("strips credential headers", () => {
    const headers = new Headers({
      authorization: BEARER,
      cookie: "sb-access-token=x",
      "cf-access-jwt-assertion": JWT,
      "x-zernio-signature": "sha256=abc",
      "x-webhook-signature": "abc",
      "content-type": "application/json",
      referer: "https://app.test/invite?token=secret-value",
    });
    const out = redactHeaders(headers);
    expect(out.authorization).toBe(REDACTED);
    expect(out.cookie).toBe(REDACTED);
    expect(out["cf-access-jwt-assertion"]).toBe(REDACTED);
    expect(out["x-zernio-signature"]).toBe(REDACTED);
    expect(out["x-webhook-signature"]).toBe(REDACTED);
    expect(out["content-type"]).toBe("application/json");
    expect(out.referer).toBe(`https://app.test/invite?token=${REDACTED}`);
    expect(isSensitiveHeader("Set-Cookie")).toBe(true);
    expect(isSensitiveHeader("x-request-id")).toBe(false);
    expect(redactHeaders({ Authorization: "Bearer zzzzzzzzzz", accept: ["a", "b"] })).toEqual({ Authorization: REDACTED, accept: "a, b" });
  });

  it("makes errors, requests and nested objects safe", () => {
    expect(redactedMessage(new Error(`fetch failed for https://s.test/x?token=${JWT}`))).toBe(`fetch failed for https://s.test/x?token=${REDACTED}`);
    expect(redactedMessage({ not: "an error" })).toBe("unknown");
    const request = new Request("https://app.test/auth/confirm?token_hash=th123&type=invite", { headers: { authorization: BEARER } });
    expect(redact(request)).toEqual({ method: "GET", url: `https://app.test/auth/confirm?token_hash=${REDACTED}&type=invite` });
    const nested = redact({ headers: { Cookie: "a=b" }, token: "t", detail: [`see ${JWT}`], error: new TypeError(BEARER), n: 1 });
    expect(nested).toEqual({ headers: { Cookie: REDACTED }, token: REDACTED, detail: [`see ${REDACTED}`], error: { name: "TypeError", message: "Bearer [redacted]" }, n: 1 });
  });

  it("email routing logs a failure without the credential in the error", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => {
      throw new Error(`request to https://api.cloudflare.test/rules?key=k-123 with ${BEARER} failed`);
    });
    await provisionFirmSlug({ claimed: "harbour" }, { token: "routing-token-value", fetchImpl });
    expect(errors).toHaveBeenCalled();
    const logged = errors.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("harbour");
    expect(logged).not.toContain("abcdefghijklmnop0123456789");
    expect(logged).not.toContain("k-123");
    expect(logged).toContain(REDACTED);
  });
});
