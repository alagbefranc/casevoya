"use server";

export type PortalPaymentIntentResult = {
  clientSecret: string | null;
  /**
   * TODO(finance): create a Stripe PaymentIntent for a real invoice and return its client_secret.
   * There is no invoices table, and this action must not charge a card.
   */
  reason?: "not_implemented";
};

export async function createPortalPaymentIntent(input: {
  organizationId?: string;
  amountCents: number;
  currency: "cad";
  description: string;
}): Promise<PortalPaymentIntentResult> {
  void input;
  return { clientSecret: null, reason: "not_implemented" };
}
