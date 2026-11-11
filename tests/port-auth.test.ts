import { describe, expect, it } from "vitest";
import { passwordOk, passwordRules } from "@/lib/auth/password";
import { firmSlug } from "@/lib/auth/slug";

describe("auth password rules", () => {
  it("matches the designer checklist", () => {
    expect(passwordRules("short")).toEqual({ len: false, mix: false, known: true });
    expect(passwordRules("longenoughok")).toEqual({ len: true, mix: false, known: true });
    expect(passwordRules("password-is-long")).toEqual({ len: true, mix: true, known: false });
    expect(passwordOk("Harbour-view-19")).toBe(true);
    expect(passwordOk("casevoya-casevoya")).toBe(false);
    // The floor stays 12. Supabase Auth's own minimum is 10 and is not lowered here.
    expect(passwordRules("a".repeat(10)).len).toBe(false);
    expect(passwordRules("a".repeat(11)).len).toBe(false);
    expect(passwordRules("a".repeat(12)).len).toBe(true);
    expect(passwordOk(`${"a".repeat(9)}1`)).toBe(false);
    expect(passwordOk(`${"a".repeat(11)}1`)).toBe(true);
  });
});

describe("firm slug", () => {
  it("builds a slug the organization check accepts", () => {
    expect(firmSlug("Northline Immigration", "abc123")).toBe("northline-immigration-abc123");
    expect(firmSlug("  !!!  ", "zz")).toMatch(/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/);
    expect(firmSlug("A".repeat(80), "q1w2e3").length).toBeLessThanOrEqual(63);
  });
});
