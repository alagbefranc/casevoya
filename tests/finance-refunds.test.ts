import { describe, expect, it } from "vitest";
import { formatMoney, parseAmount } from "@/modules/finance/money";
import {
  disputeOpen,
  disputeReason,
  disputeState,
  financeNeedsStepUp,
  invoiceState,
  paymentState,
  readRefund,
  REFUND_REASONS,
  refundError,
  refundState,
} from "@/modules/sheet/finance-present";

const PAYMENT = "22222222-2222-4222-8222-222222222222";

describe("refund amounts in minor units", () => {
  it("reads the typed refund into integer cents, within the refundable remainder", () => {
    expect(readRefund({ payment: PAYMENT, amount: "130", reason: "requested_by_customer" }, "CAD", 113_000)).toEqual({
      input: { paymentId: PAYMENT, amountCents: 13_000, reason: "requested_by_customer" },
    });
    expect(readRefund({ payment: PAYMENT, amount: "1,130.00", reason: "" }, "CAD", 113_000)).toEqual({ input: { paymentId: PAYMENT, amountCents: 113_000, reason: null } });
    // 0.1 + 0.2 never happens: string arithmetic.
    expect(readRefund({ payment: PAYMENT, amount: "0.30", reason: "duplicate" }, "CAD", null)).toMatchObject({ input: { amountCents: 30 } });
  });

  it("refuses more than is left, zero, too many decimals, a bad payment or reason", () => {
    expect(readRefund({ payment: PAYMENT, amount: "1130.01", reason: "" }, "CAD", 113_000)).toEqual({ error: "That’s more than is left to refund on this payment." });
    for (const amount of ["0", "0.00", "-1", "1.234", "abc", ""]) {
      expect(readRefund({ payment: PAYMENT, amount, reason: "" }, "CAD", 113_000), amount).toHaveProperty("error");
    }
    expect(readRefund({ payment: "not-a-uuid", amount: "1", reason: "" }, "CAD", 100)).toHaveProperty("error");
    expect(readRefund({ payment: PAYMENT, amount: "1", reason: "because" }, "CAD", 100)).toEqual({ error: "Choose a reason." });
  });

  it("offers only Stripe's refund reasons", () => {
    expect(REFUND_REASONS.map((reason) => reason.value).sort()).toEqual(["", "duplicate", "fraudulent", "requested_by_customer"]);
  });

  it("prefills the dialog with an amount the parser reads back exactly", () => {
    // finance-load writes the refundable remainder without grouping ("1030.00").
    expect(parseAmount("1030.00", "CAD")).toBe(103_000);
    expect(formatMoney(103_000, "CAD")).toBe("CAD 1,030.00");
  });
});

describe("refund and dispute states", () => {
  it("keeps a partly refunded invoice paid with the refunded amount, and a fully refunded one Refunded", () => {
    expect(invoiceState("paid", "2026-10-01", "2026-10-18", false, "CAD 130.00")).toEqual({ tone: "ok", label: "Paid", flag: "paid", detail: "CAD 130.00 refunded" });
    expect(invoiceState("partially_paid", "2026-11-01", "2026-10-18", false, "CAD 10.00")).toMatchObject({ label: "Partially paid", detail: "CAD 10.00 refunded" });
    expect(invoiceState("refunded", "2026-10-01", "2026-10-18")).toEqual({ tone: "gr", label: "Refunded", flag: "closed" });
    expect(invoiceState("paid", "2026-10-01", "2026-10-18")).toEqual({ tone: "ok", label: "Paid", flag: "paid" });
  });

  it("badges a payment by what was refunded of it", () => {
    expect(paymentState("succeeded", { refundedCents: 0, receivedCents: 1_000, refunded: "CAD 0.00" })).toEqual({ tone: "ok", label: "Received" });
    expect(paymentState("succeeded", { refundedCents: 300, receivedCents: 1_000, refunded: "CAD 3.00" })).toEqual({ tone: "ok", label: "Received", detail: "CAD 3.00 refunded" });
    expect(paymentState("succeeded", { refundedCents: 1_000, receivedCents: 1_000, refunded: "CAD 10.00" })).toEqual({ tone: "gr", label: "Refunded" });
    expect(paymentState("failed", { refundedCents: 0, receivedCents: 0, refunded: "CAD 0.00" })).toEqual({ tone: "bad", label: "Payment failed" });
  });

  it("says what Stripe confirmed about a refund", () => {
    expect(refundState("pending")).toEqual({ tone: "rev", label: "Processing" });
    expect(refundState("succeeded")).toEqual({ tone: "ok", label: "Refunded" });
    expect(refundState("failed", "expired_or_canceled_card")).toEqual({ tone: "bad", label: "Failed", detail: "card closed" });
    expect(refundState("failed", "something_new")).toEqual({ tone: "bad", label: "Failed", detail: "something new" });
    expect(refundState("canceled")).toEqual({ tone: "gr", label: "Canceled" });
  });

  it("shows a dispute's status honestly, and when the firm can still answer it", () => {
    expect(disputeState("needs_response")).toEqual({ tone: "chg", label: "Evidence needed" });
    expect(disputeState("warning_needs_response")).toEqual({ tone: "chg", label: "Inquiry", detail: "response needed" });
    expect(disputeState("lost")).toEqual({ tone: "bad", label: "Lost" });
    expect(disputeState("won")).toEqual({ tone: "ok", label: "Won" });
    expect(disputeOpen("needs_response")).toBe(true);
    expect(disputeOpen("lost")).toBe(false);
    expect(disputeReason("product_not_received")).toBe("Product not received");
    expect(disputeReason(null)).toBe("No reason given");
  });

  it("never passes a database message through, and sends a step-up refusal to step-up", () => {
    expect(refundError("refund exceeds the amount received")).toBe("That’s more than is left to refund on this payment.");
    expect(refundError("billing access denied")).toBe("Only the firm owner or the matter’s finance user can refund this payment.");
    expect(refundError('relation "public.invoice_refunds" violates something')).not.toMatch(/invoice_refunds/);
    expect(financeNeedsStepUp(refundError("step-up is required"))).toBe(true);
  });
});
