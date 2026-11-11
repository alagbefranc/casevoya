import { REDACTED, redactText } from "@/lib/log/redact";

/**
 * One Workers log line when a firm Stripe call throws. The browser still gets the generic
 * sentence; this line is the type, code and request id Stripe returned, with keys removed.
 */

const STRIPE_KEY = /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+/g;
const CLIENT_SECRET = /\b[A-Za-z0-9]+_secret_[A-Za-z0-9]+\b/g;
const CLIENT_SECRET_FIELD = /(client_secret["']?\s*[:=]\s*["']?)[^\s"',}]+/gi;
const ACCOUNT_ID = /^acct_[A-Za-z0-9]{6,250}$/;

export type StripeCall = "connectStripeAccount" | "createAccountSession" | "refreshStripeAccount";

export function redactStripeText(text: string): string {
  return redactText(text)
    .replace(STRIPE_KEY, REDACTED)
    .replace(CLIENT_SECRET, REDACTED)
    .replace(CLIENT_SECRET_FIELD, `$1${REDACTED}`);
}

function textField(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return redactStripeText(value).slice(0, 500);
}

function statusCode(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^[0-9]{3}$/.test(value)) return Number(value);
  return null;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

/** Stripe's request id, from the error or its raw payload. Headers on raw are never read. */
function requestId(error: Record<string, unknown>, raw: Record<string, unknown> | null): string | null {
  return textField(error.requestId) ?? (raw ? textField(raw.requestId) : null);
}

/**
 * Logs one JSON line: operation, connected account id, livemode, and Stripe's type, code,
 * decline_code, param, message, statusCode and requestId. Returns the line.
 */
export function logStripeFailure(input: { operation: StripeCall; accountId: string | null; livemode: boolean; error: unknown }): string {
  const error = record(input.error);
  const raw = error ? record(error.raw) : null;
  const message = error
    ? textField(error.message) ?? (raw ? textField(raw.message) : null)
    : typeof input.error === "string"
      ? textField(input.error)
      : null;
  const line = JSON.stringify({
    event: "stripe.error",
    operation: input.operation,
    accountId: input.accountId && ACCOUNT_ID.test(input.accountId) ? input.accountId : null,
    livemode: input.livemode === true,
    type: textField(error?.type) ?? textField(raw?.type),
    code: textField(error?.code) ?? textField(raw?.code),
    decline_code: textField(error?.decline_code) ?? textField(raw?.decline_code),
    param: textField(error?.param) ?? textField(raw?.param),
    message,
    statusCode: statusCode(error?.statusCode) ?? statusCode(raw?.statusCode),
    requestId: error ? requestId(error, raw) : null,
  });
  console.error(line);
  return line;
}
