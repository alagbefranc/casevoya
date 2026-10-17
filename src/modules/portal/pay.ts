/** Prototype pay states from portal-pay.html. A real charge waits on the finance PaymentIntent. */
export const PAY_STATES = ["ready", "processing", "declined", "3ds", "success", "paid"] as const;

export type PayState = (typeof PAY_STATES)[number];

export function payStateFromQuery(value: string | undefined): PayState {
  return (PAY_STATES as readonly string[]).includes(value ?? "") ? (value as PayState) : "ready";
}

/** The designer's Pay button: ready opens the bank check, every other armed state lands on paid. */
export function nextPrototypePayState(state: string): "3ds" | "success" {
  return state === "ready" ? "3ds" : "success";
}
