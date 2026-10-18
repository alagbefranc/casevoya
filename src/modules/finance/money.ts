/**
 * Money is integer minor units plus an ISO 4217 code (FIN-05). Never floats.
 * CAD is the only invoice currency for now; the helpers know the minor-unit exponent of the
 * few currencies Stripe treats as zero- or three-decimal so they stay correct when more are added.
 */

export const INVOICE_CURRENCIES = ["CAD"] as const;
export type InvoiceCurrency = (typeof INVOICE_CURRENCIES)[number];

/** Stripe's zero-decimal and three-decimal currencies (https://docs.stripe.com/currencies). */
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
const THREE_DECIMAL = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);

/** Largest amount an invoice may carry, in minor units (matches the database check). */
export const MAX_MINOR = 99_999_999_999;

export function normalizeCurrency(code: string | null | undefined): string | null {
  const value = (code ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(value) ? value : null;
}

export function isInvoiceCurrency(code: string | null | undefined): code is InvoiceCurrency {
  const value = normalizeCurrency(code);
  return Boolean(value && (INVOICE_CURRENCIES as readonly string[]).includes(value));
}

export function minorDigits(currency: string): number {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

/**
 * Parses what a person typed ("1,130", "1130.5", "$1 130.00") into minor units.
 * Returns null for anything that is not a positive amount with at most the currency's decimals.
 * Done with string arithmetic so 0.1 + 0.2 problems never arise.
 */
export function parseAmount(input: string, currency: string): number | null {
  const digits = minorDigits(currency);
  const cleaned = input.trim().replace(/^(CA)?\$|\s|,/gi, "").replace(/^(CAD|USD)/i, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  if (fraction.length > digits) return null;
  const minor = Number(whole + fraction.padEnd(digits, "0"));
  if (!Number.isSafeInteger(minor) || minor <= 0 || minor > MAX_MINOR) return null;
  return minor;
}

/** "1,130.00" for 113000 CAD. Grouping is fixed (en-CA) so server and browser render the same. */
export function formatAmount(minor: number, currency: string): string {
  const digits = minorDigits(currency);
  const negative = minor < 0;
  const value = String(Math.abs(Math.trunc(minor))).padStart(digits + 1, "0");
  const whole = digits ? value.slice(0, -digits) : value;
  const fraction = digits ? value.slice(-digits) : "";
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/** "CAD 1,130.00". */
export function formatMoney(minor: number, currency: string): string {
  return `${currency.toUpperCase()} ${formatAmount(minor, currency)}`;
}
