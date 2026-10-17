import { describe, expect, it } from "vitest";
import { ORG_HEADER, REQUEST_ID_HEADER, isUuid, isValidOrgSlug, resolveRequestId, tenantHeaders } from "@/lib/tenant/context";
import { STAFF_ROLES, isStaffRole } from "@/lib/tenant/roles";

describe("tenantHeaders", () => {
  it("adds the org header only for a valid UUID", () => {
    const id = "4C8F9A5B-3F89-44DB-924A-91BE93014896";
    expect(tenantHeaders(id)).toEqual({ [ORG_HEADER]: id.toLowerCase() });
    expect(tenantHeaders(null)).toEqual({});
    expect(() => tenantHeaders("'; drop table x; --")).toThrow();
  });

  it("passes through a well-formed request id", () => {
    expect(tenantHeaders(null, "req-12345678")).toEqual({ [REQUEST_ID_HEADER]: "req-12345678" });
  });
});

describe("resolveRequestId", () => {
  it("rejects malformed ids and mints a uuid", () => {
    expect(isUuid(resolveRequestId("bad id with spaces"))).toBe(true);
    expect(isUuid(resolveRequestId(null))).toBe(true);
  });
});

describe("isValidOrgSlug (mirrors DB check)", () => {
  it.each([
    ["firm-a", true],
    ["a1b", true],
    ["a1", false],
    ["-bad", false],
    ["Bad", false],
    ["a", false],
  ])("%s -> %s", (slug, ok) => expect(isValidOrgSlug(slug)).toBe(ok));
});

describe("roles", () => {
  it("firm owner is staff, client is not", () => {
    expect(isStaffRole("firm_owner")).toBe(true);
    expect(isStaffRole("client")).toBe(false);
    expect(STAFF_ROLES).not.toContain("sponsor");
  });
});
