/**
 * DES-04: a card payment that didn't go through, in plain words, with the next step. Pure: the pay
 * page (pay-live.tsx) passes the error Stripe.js returned from confirmPayment (type, code,
 * decline_code), this names it. Nothing is charged when Stripe returns an error, so every message
 * says so. TEST MODE ONLY: the test cards (4000 0000 0000 0002 declined, 4000 0000 0000 9995
 * insufficient funds, 4000 0000 0000 0069 expired, a 3-D Secure card failed) produce these codes.
 */

export type PayFailureKind =
  | "declined"
  | "insufficient_funds"
  | "expired_card"
  | "card_details"
  | "authentication_failed"
  | "processing_error"
  | "unknown";

/** What the person can do next: try the card form again (another card), or ask the firm. */
export type PayFailure = {
  kind: PayFailureKind;
  /** The sentence shown in the Designer's declined message (`p.err`). */
  message: string;
  /** The next step, after the message. */
  next: string;
};

export type StripeLikeError = {
  type?: string | null;
  code?: string | null;
  decline_code?: string | null;
  message?: string | null;
};

const NOT_CHARGED = "You haven’t been charged.";

export function payFailure(error: StripeLikeError | null | undefined, firmName: string): PayFailure {
  const code = error?.code ?? "";
  const decline = error?.decline_code ?? "";
  const ask = `ask ${firmName} for bank transfer details`;
  if (decline === "insufficient_funds" || code === "insufficient_funds") {
    return {
      kind: "insufficient_funds",
      message: `Your card was declined for insufficient funds. ${NOT_CHARGED}`,
      next: `Try another card, or ${ask}.`,
    };
  }
  if (code === "expired_card" || decline === "expired_card") {
    return { kind: "expired_card", message: `This card has expired. ${NOT_CHARGED}`, next: `Use another card, or ${ask}.` };
  }
  if (code === "incorrect_cvc" || code === "invalid_cvc" || decline === "incorrect_cvc") {
    return { kind: "card_details", message: `The security code doesn’t match this card. ${NOT_CHARGED}`, next: "Check the three or four digits on the card and try again." };
  }
  if (code === "incorrect_number" || code === "invalid_number" || code === "invalid_expiry_month" || code === "invalid_expiry_year" || decline === "incorrect_number") {
    return { kind: "card_details", message: `The card details don’t match a card. ${NOT_CHARGED}`, next: "Check the number and expiry date, then try again." };
  }
  if (code === "payment_intent_authentication_failure" || code === "authentication_required" || decline === "authentication_required") {
    return {
      kind: "authentication_failed",
      message: `Your bank couldn’t confirm it’s you, so the payment stopped. ${NOT_CHARGED}`,
      next: `Try again and finish your bank’s check, use another card, or ${ask}.`,
    };
  }
  if (code === "processing_error" || error?.type === "api_error" || error?.type === "api_connection_error") {
    return { kind: "processing_error", message: `The payment couldn’t be processed just now. ${NOT_CHARGED}`, next: "Wait a moment and try again." };
  }
  if (code === "card_declined" || decline || error?.type === "card_error") {
    return { kind: "declined", message: `Your card was declined. ${NOT_CHARGED}`, next: `Try another card, or ${ask}.` };
  }
  const said = error?.message?.trim();
  return {
    kind: "unknown",
    message: `${said ? `${said}${/[.!?]$/.test(said) ? "" : "."} ` : "The payment didn’t go through. "}${NOT_CHARGED}`,
    next: `Try again, or ${ask}.`,
  };
}

/**
 * A payment that came back from a bank redirect (`?redirect_status=failed`): Stripe sends the person
 * back to this page with the outcome in the address. Null when the address says nothing failed.
 */
export function redirectPayFailure(search: string, firmName: string): PayFailure | null {
  const params = new URLSearchParams(search);
  if (params.get("redirect_status") !== "failed") return null;
  return payFailure({ code: "payment_intent_authentication_failure" }, firmName);
}
