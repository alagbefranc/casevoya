import { describe, expect, it } from "vitest";
import { portHref } from "@/components/port/use-port";
import { redirectUrl, safeNext, safeRedirect } from "@/lib/auth/redirect";

describe("safeRedirect", () => {
  it("keeps same-site paths with their query and hash", () => {
    expect(safeRedirect("/sheet")).toBe("/sheet");
    expect(safeRedirect("/sheet/matters?view=due#top")).toBe("/sheet/matters?view=due#top");
    expect(safeRedirect("/portal/x?y=1#z")).toBe("/portal/x?y=1#z");
    expect(safeRedirect("/accept/client?token=abc")).toBe("/accept/client?token=abc");
    expect(safeRedirect("/mfa?step=6&next=%2Fsheet%2Fdocuments&for=document_open")).toBe("/mfa?step=6&next=%2Fsheet%2Fdocuments&for=document_open");
    expect(safeRedirect("/start-trial")).toBe("/start-trial");
  });

  it.each([
    ["absolute URL", "https://evil.example/"],
    ["absolute http URL", "http://evil.example/x"],
    ["javascript URL", "javascript:alert(1)"],
    ["data URL", "data:text/html,<script>alert(1)</script>"],
    ["protocol-relative", "//evil.example"],
    ["backslash, which browsers read as a slash", "/\\evil.example"],
    ["leading backslash", "\\/evil.example"],
    ["backslash later in the path", "/sheet\\x"],
    ["tab inside the slashes", "/\t/evil.example"],
    ["newline inside the slashes", "/\n/evil.example"],
    ["space", "/sheet /x"],
    ["DEL", "/sheet\u007f"],
    ["C1 control", "/sheet\u0085x"],
    ["encoded tab between slashes", "/%09/evil.example"],
    ["dot segment", "/.//evil.example"],
    ["encoded dot segment", "/%2e//evil.example"],
    ["parent segment", "/a/..//evil.example"],
    ["encoded parent segment", "/a/%2e%2e//evil.example"],
    ["encoded slashes at the start", "/%2F%2Fevil.example"],
    ["encoded backslash", "/%5Cevil.example"],
    ["encoded parent segments that decode to //", "/a/..%2F..%2F/evil.example"],
    ["userinfo on the probe origin", "https://user:pass@redirect.invalid/sheet"],
    ["userinfo, protocol-relative", "//user@evil.example/"],
    ["relative path", "sheet"],
    ["encoded slashes without a leading slash", "%2F%2Fevil.example"],
    ["empty", ""],
    ["very long", `/${"a".repeat(2048)}`],
    ["malformed escape", "/%E0%A4%A"],
  ])("falls back for %s", (_label, value) => {
    expect(safeRedirect(value)).toBe("/app");
  });

  it("treats /@host as a same-site path, never a host", () => {
    expect(safeRedirect("/@evil.example")).toBe("/@evil.example");
    expect(new URL(safeRedirect("/@evil.example"), "https://app.casevoya.ca").origin).toBe("https://app.casevoya.ca");
  });

  it("keeps encoded slashes later in the path, and never outputs //", () => {
    expect(safeRedirect("/sheet/%2F%2Fx")).toBe("/sheet/%2F%2Fx");
    expect(safeRedirect("/%2F%2Fx").startsWith("//")).toBe(false);
  });

  it("refuses non-strings and uses the given fallback", () => {
    expect(safeRedirect(null, "/portal")).toBe("/portal");
    expect(safeRedirect(undefined)).toBe("/app");
    expect(safeRedirect(42)).toBe("/app");
    expect(safeRedirect({ toString: () => "/sheet" })).toBe("/app");
  });

  it("accepts the longest allowed value", () => {
    const long = `/${"a".repeat(2047)}`;
    expect(safeRedirect(long)).toBe(long);
  });

  it("keeps safeNext as the same check", () => {
    expect(safeNext("/a/..//evil.example")).toBe("/app");
    expect(safeNext(null, "/portal")).toBe("/portal");
    expect(safeNext("/sheet?x=1")).toBe("/sheet?x=1");
  });
});

describe("portHref (auth screens' navigation)", () => {
  const here = { href: "https://app.casevoya.ca/mfa?next=%2Fsheet", origin: "https://app.casevoya.ca" };

  it("keeps same-site paths and same-origin absolute URLs", () => {
    expect(portHref("/sheet", here)).toBe("/sheet");
    expect(portHref("/mfa?step=2&next=%2Fsetup", here)).toBe("/mfa?step=2&next=%2Fsetup");
    expect(portHref("https://app.casevoya.ca/portal/x?y=1#z", here)).toBe("/portal/x?y=1#z");
  });

  it.each(["https://evil.example/", "//evil.example", "/.//evil.example", "/a/..//evil.example", "/\\evil.example", "javascript:alert(1)", "data:text/html,x", "", null])(
    "refuses %s",
    (value) => {
      expect(portHref(value, here)).toBeNull();
    },
  );
});

describe("redirectUrl", () => {
  const BASE = "https://app.casevoya.ca/auth/confirm?code=x";

  it("resolves a safe path on the base origin", () => {
    expect(redirectUrl("/accept/client?token=abc", BASE).href).toBe("https://app.casevoya.ca/accept/client?token=abc");
    expect(redirectUrl("/portal/x?y=1#z", BASE).href).toBe("https://app.casevoya.ca/portal/x?y=1#z");
  });

  it.each(["https://evil.example/", "//evil.example", "/.//evil.example", "/a/%2e%2e//evil.example", "/\\evil.example", "javascript:alert(1)"])(
    "keeps %s on the base origin, at the fallback",
    (value) => {
      const url = redirectUrl(value, BASE);
      expect(url.origin).toBe("https://app.casevoya.ca");
      expect(url.href).toBe("https://app.casevoya.ca/app");
    },
  );

  it("uses the given fallback, and refuses an unsafe fallback", () => {
    expect(redirectUrl("//evil.example", BASE, "/sign-in").href).toBe("https://app.casevoya.ca/sign-in");
    expect(redirectUrl("//evil.example", BASE, "//evil.example").href).toBe("https://app.casevoya.ca/");
  });
});
