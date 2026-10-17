import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/auth/redirect";

describe("safeNext", () => {
  it("keeps same-site paths with their query and hash", () => {
    expect(safeNext("/sheet")).toBe("/sheet");
    expect(safeNext("/sheet/matters?view=due#top")).toBe("/sheet/matters?view=due#top");
  });

  it.each([
    ["absolute URL", "https://evil.example/"],
    ["protocol-relative", "//evil.example"],
    ["backslash, which browsers read as a slash", "/\\evil.example"],
    ["tab inside the slashes", "/\t/evil.example"],
    ["newline inside the slashes", "/\n/evil.example"],
    ["javascript URL", "javascript:alert(1)"],
    ["relative path", "sheet"],
    ["empty", ""],
  ])("falls back for %s", (_label, value) => {
    expect(safeNext(value)).toBe("/app");
  });

  it("uses the given fallback for missing values", () => {
    expect(safeNext(null, "/portal")).toBe("/portal");
  });
});
