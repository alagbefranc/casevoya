import { describe, expect, it } from "vitest";
import {
  activeSecretKey,
  billingWebhookSecrets,
  checkPublishableKey,
  checkSecretKey,
  checkWebhookSecret,
  connectWebhookSecrets,
  publishableKey,
  secretKeyForMode,
  stripeMode,
} from "@/modules/finance/keys";
import { formatAmount, formatMoney, isInvoiceCurrency, minorDigits, normalizeCurrency, parseAmount } from "@/modules/finance/money";
import { invoiceState, readNewInvoice } from "@/modules/sheet/finance-present";

describe("invoice amounts in minor units", () => {
  it("parses what a person types into integer cents without floating point", () => {
    expect(parseAmount("1130", "CAD")).toBe(113_000);
    expect(parseAmount("1,130.00", "CAD")).toBe(113_000);
    expect(parseAmount("$1 130.5", "CAD")).toBe(113_050);
    expect(parseAmount("CAD 0.10", "CAD")).toBe(10);
    expect(parseAmount("0.29", "CAD")).toBe(29);
    expect(parseAmount("19.99", "CAD")).toBe(1_999);
  });

  it("refuses zero, negatives, too many decimals and non-numbers", () => {
    for (const bad of ["", "0", "0.00", "-5", "1.234", "abc", "1e5", "1.2.3", "999999999999"]) {
      expect(parseAmount(bad, "CAD"), bad).toBeNull();
    }
  });

  it("knows zero- and three-decimal currencies", () => {
    expect(minorDigits("CAD")).toBe(2);
    expect(minorDigits("jpy")).toBe(0);
    expect(minorDigits("KWD")).toBe(3);
    expect(parseAmount("1500", "JPY")).toBe(1_500);
    expect(parseAmount("1500.5", "JPY")).toBeNull();
    expect(parseAmount("1.234", "KWD")).toBe(1_234);
  });

  it("formats minor units the same on server and browser", () => {
    expect(formatAmount(113_000, "CAD")).toBe("1,130.00");
    expect(formatAmount(5, "CAD")).toBe("0.05");
    expect(formatAmount(0, "CAD")).toBe("0.00");
    expect(formatAmount(123_456_789, "CAD")).toBe("1,234,567.89");
    expect(formatAmount(1_500, "JPY")).toBe("1,500");
    expect(formatMoney(113_000, "cad")).toBe("CAD 1,130.00");
  });

  it("only CAD is an invoice currency for now", () => {
    expect(normalizeCurrency(" cad ")).toBe("CAD");
    expect(normalizeCurrency("ca")).toBeNull();
    expect(isInvoiceCurrency("cad")).toBe(true);
    expect(isInvoiceCurrency("USD")).toBe(false);
  });
});

describe("New invoice dialog and invoice states", () => {
  const MATTER = "11111111-1111-4111-8111-111111111111";
  it("reads the typed amount into minor units and refuses bad input", () => {
    expect(readNewInvoice({ matter: MATTER, description: " Preparation ", amount: "1,130.00", currency: "cad", due: "2026-11-17" }, "2026-10-18")).toEqual({
      input: { matterId: MATTER, description: "Preparation", amountCents: 113_000, currency: "CAD", dueOn: "2026-11-17" },
    });
    expect(readNewInvoice({ matter: "x", description: "a", amount: "1", currency: "CAD", due: "2026-11-17" }, "2026-10-18")).toHaveProperty("error");
    expect(readNewInvoice({ matter: MATTER, description: "a", amount: "1", currency: "USD", due: "2026-11-17" }, "2026-10-18")).toHaveProperty("error");
    expect(readNewInvoice({ matter: MATTER, description: "a", amount: "0", currency: "CAD", due: "2026-11-17" }, "2026-10-18")).toHaveProperty("error");
    expect(readNewInvoice({ matter: MATTER, description: "a", amount: "1", currency: "CAD", due: "2026-10-17" }, "2026-10-18")).toHaveProperty("error");
  });

  it("derives Overdue and processing, never storing them", () => {
    expect(invoiceState("issued", "2026-10-17", "2026-10-18")).toMatchObject({ label: "Overdue", flag: "overdue" });
    expect(invoiceState("issued", "2026-10-18", "2026-10-18")).toMatchObject({ label: "Issued", flag: "issued" });
    expect(invoiceState("issued", "2026-10-17", "2026-10-18", true)).toMatchObject({ label: "Payment processing" });
    expect(invoiceState("paid", "2026-10-01", "2026-10-18")).toMatchObject({ label: "Paid", tone: "ok" });
    expect(invoiceState("partially_paid", "2026-11-01", "2026-10-18")).toMatchObject({ flag: "partial" });
  });
});

describe("Stripe keys are test mode only", () => {
  it("accepts only test keys and treats live keys as not configured", () => {
    expect(checkSecretKey("sk_test_51Synthetic0000000000")).toMatchObject({ ok: true });
    expect(checkSecretKey("rk_test_51Synthetic0000000000")).toMatchObject({ ok: true });
    expect(checkSecretKey("sk_live_51Synthetic0000000000")).toEqual({ ok: false, reason: "not_test" });
    expect(checkSecretKey("rk_live_51Synthetic0000000000")).toEqual({ ok: false, reason: "not_test" });
    expect(checkSecretKey("pk_test_51Synthetic0000000000")).toEqual({ ok: false, reason: "not_test" });
    expect(checkSecretKey(undefined)).toEqual({ ok: false, reason: "missing" });
    expect(checkPublishableKey("pk_test_51Synthetic0000000000")).toMatchObject({ ok: true });
    expect(checkPublishableKey("pk_live_51Synthetic0000000000")).toEqual({ ok: false, reason: "not_test" });
    expect(checkPublishableKey("sk_test_51Synthetic0000000000")).toEqual({ ok: false, reason: "not_test" });
    expect(checkWebhookSecret("whsec_Synthetic0000000000")).toMatchObject({ ok: true });
    expect(checkWebhookSecret("whsec_live_Synthetic00000")).toEqual({ ok: false, reason: "not_test" });
    expect(checkWebhookSecret("")).toEqual({ ok: false, reason: "missing" });
  });
});

describe("Stripe live mode keys", () => {
  const TEST_SK = "sk_test_51Synthetic0000000000";
  const LIVE_SK = "sk_live_51Synthetic0000000000";
  const TEST_PK = "pk_test_51Synthetic0000000000";
  const LIVE_PK = "pk_live_51Synthetic0000000000";

  it("uses STRIPE_SECRET_KEY first (live or test), else the test key, and never falls back from a bad main key", () => {
    expect(activeSecretKey({ STRIPE_SECRET_KEY: LIVE_SK, STRIPE_TEST_SECRET_KEY: TEST_SK })).toEqual({ key: LIVE_SK, mode: "live" });
    expect(activeSecretKey({ STRIPE_SECRET_KEY: TEST_SK })).toEqual({ key: TEST_SK, mode: "test" });
    expect(activeSecretKey({ STRIPE_TEST_SECRET_KEY: TEST_SK })).toEqual({ key: TEST_SK, mode: "test" });
    expect(activeSecretKey({ STRIPE_TEST_SECRET_KEY: LIVE_SK })).toBeNull();
    expect(activeSecretKey({ STRIPE_SECRET_KEY: "sk_live_bad", STRIPE_TEST_SECRET_KEY: TEST_SK })).toBeNull();
    expect(activeSecretKey({ STRIPE_SECRET_KEY: LIVE_PK })).toBeNull();
    expect(stripeMode({})).toBeNull();
    expect(stripeMode({ STRIPE_SECRET_KEY: LIVE_SK })).toBe("live");
    // The test key stays usable for cleaning up test-mode links after going live.
    expect(secretKeyForMode("test", { STRIPE_SECRET_KEY: LIVE_SK, STRIPE_TEST_SECRET_KEY: TEST_SK })).toBe(TEST_SK);
    expect(secretKeyForMode("live", { STRIPE_TEST_SECRET_KEY: TEST_SK })).toBeNull();
  });

  it("gives the browser a publishable key only of the server's mode", () => {
    expect(publishableKey({ STRIPE_SECRET_KEY: LIVE_SK, STRIPE_PUBLISHABLE_KEY: LIVE_PK, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: TEST_PK })).toBe(LIVE_PK);
    expect(publishableKey({ STRIPE_SECRET_KEY: LIVE_SK, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: TEST_PK })).toBeNull();
    expect(publishableKey({ STRIPE_TEST_SECRET_KEY: TEST_SK, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: TEST_PK })).toBe(TEST_PK);
    expect(publishableKey({ STRIPE_TEST_SECRET_KEY: TEST_SK, STRIPE_PUBLISHABLE_KEY: LIVE_PK })).toBeNull();
    expect(publishableKey({ STRIPE_PUBLISHABLE_KEY: LIVE_PK })).toBeNull();
  });

  it("collects the live and test webhook secrets, live first", () => {
    const live = "whsec_syntheticLive000000000";
    const test = "whsec_syntheticTest000000000";
    expect(connectWebhookSecrets({ STRIPE_LIVE_WEBHOOK_SECRET: live, STRIPE_WEBHOOK_SECRET: test })).toEqual([live, test]);
    expect(connectWebhookSecrets({ STRIPE_WEBHOOK_SECRET: test })).toEqual([test]);
    expect(billingWebhookSecrets({ STRIPE_LIVE_BILLING_WEBHOOK_SECRET: live, STRIPE_BILLING_WEBHOOK_SECRET: "nope" })).toEqual([live]);
    expect(billingWebhookSecrets({})).toEqual([]);
  });
});
