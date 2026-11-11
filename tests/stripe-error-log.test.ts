import { afterEach, describe, expect, it, vi } from "vitest";
import { logStripeFailure } from "@/modules/finance/stripe-error-log";

const ACCOUNT = "acct_1TestAccount0001";
const FAKE_SECRET = "sk_live_FAKEKEYVALUE12345678";
const FAKE_RESTRICTED = "rk_test_FAKERESTRICTED12345";
const FAKE_PUBLISHABLE = "pk_live_FAKEPUBLISHABLE12345";
const FAKE_CLIENT_SECRET = "accs_secret_FAKECLIENTSECRET99";

describe("Stripe failure log", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs Stripe's type, code, decline_code, param, message, statusCode and requestId with the account", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const line = logStripeFailure({
      operation: "createAccountSession",
      accountId: ACCOUNT,
      livemode: true,
      error: {
        type: "invalid_request_error",
        code: "account_invalid",
        decline_code: "do_not_honor",
        param: "components[account_onboarding]",
        message: "Stripe refused the account session.",
        statusCode: 400,
        requestId: "req_session123",
      },
    });
    const logged = JSON.parse(line) as Record<string, unknown>;
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]?.[0]).toBe(line);
    expect(logged).toEqual({
      event: "stripe.error",
      operation: "createAccountSession",
      accountId: ACCOUNT,
      livemode: true,
      type: "invalid_request_error",
      code: "account_invalid",
      decline_code: "do_not_honor",
      param: "components[account_onboarding]",
      message: "Stripe refused the account session.",
      statusCode: 400,
      requestId: "req_session123",
    });
  });

  it("reads requestId from raw when the error itself has none, and ignores raw headers", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const line = logStripeFailure({
      operation: "refreshStripeAccount",
      accountId: ACCOUNT,
      livemode: false,
      error: {
        type: "api_error",
        message: "Stripe didn't answer.",
        raw: {
          requestId: "req_fromraw",
          statusCode: 500,
          headers: { Authorization: `Bearer ${FAKE_SECRET}` },
        },
      },
    });
    const logged = JSON.parse(line) as Record<string, unknown>;
    expect(logged.operation).toBe("refreshStripeAccount");
    expect(logged.livemode).toBe(false);
    expect(logged.requestId).toBe("req_fromraw");
    expect(logged.statusCode).toBe(500);
    expect(logged.decline_code).toBeNull();
    expect(line).not.toContain(FAKE_SECRET);
    expect(line).not.toContain("Authorization");
  });

  it("redacts a secret key, restricted key, publishable key and client secret inside the message", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const line = logStripeFailure({
      operation: "connectStripeAccount",
      accountId: null,
      livemode: true,
      error: {
        type: "invalid_request_error",
        message: `refused ${FAKE_SECRET} ${FAKE_RESTRICTED} ${FAKE_PUBLISHABLE} client_secret=${FAKE_CLIENT_SECRET}`,
        requestId: "req_redact",
      },
    });
    expect(line).not.toContain(FAKE_SECRET);
    expect(line).not.toContain(FAKE_RESTRICTED);
    expect(line).not.toContain(FAKE_PUBLISHABLE);
    expect(line).not.toContain(FAKE_CLIENT_SECRET);
    expect(line).not.toContain("FAKEKEYVALUE");
    expect(line).not.toContain("FAKECLIENTSECRET");
    expect(line).toContain("[redacted]");
    expect(JSON.parse(line).accountId).toBeNull();
    expect(JSON.parse(line).code).toBeNull();
    expect(JSON.parse(line).param).toBeNull();
  });
});
