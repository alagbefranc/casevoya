import { describe, expect, it } from "vitest";
import { nextPrototypePayState, payStateFromQuery } from "@/modules/portal/pay";

describe("portal pay states", () => {
  it("keeps the designer's ready to bank-check to paid path", () => {
    expect(nextPrototypePayState("ready")).toBe("3ds");
    expect(nextPrototypePayState("declined")).toBe("success");
    expect(nextPrototypePayState("3ds")).toBe("success");
  });

  it("ignores an unknown state query", () => {
    expect(payStateFromQuery(undefined)).toBe("ready");
    expect(payStateFromQuery("nope")).toBe("ready");
    expect(payStateFromQuery("paid")).toBe("paid");
  });
});
