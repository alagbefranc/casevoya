import { describe, expect, it } from "vitest";
import { LISTED_PAYMENT_STATUSES, paymentState, shortStripeId } from "@/modules/sheet/finance-present";

describe("Payments tab wording", () => {
  it("badges each listed card payment status with the Designer's tones", () => {
    expect(paymentState("succeeded")).toEqual({ tone: "ok", label: "Received" });
    expect(paymentState("processing")).toEqual({ tone: "rev", label: "Processing" });
    expect(paymentState("failed")).toEqual({ tone: "bad", label: "Payment failed" });
    expect(paymentState("canceled")).toEqual({ tone: "gr", label: "Canceled" });
  });

  it("does not list payments where nothing was charged", () => {
    expect(LISTED_PAYMENT_STATUSES).not.toContain("requires_payment");
    expect([...LISTED_PAYMENT_STATUSES].sort()).toEqual(["canceled", "failed", "processing", "succeeded"]);
  });

  it("shortens Stripe ids to their prefix and last six characters", () => {
    expect(shortStripeId("evt_1QbC2dEfGhIjKlMn")).toBe("evt_…IjKlMn");
    expect(shortStripeId("pi_3PqRsTuVwXyZ0123")).toBe("pi_…yZ0123");
    expect(shortStripeId("evt_5530")).toBe("evt_5530");
    expect(shortStripeId(null)).toBe("—");
  });
});
